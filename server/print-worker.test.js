import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { readFile, access } from "node:fs/promises";
import { createPrintQueue } from "./print-queue.js";
import { createPrintWorker } from "./print-worker.js";
import { renderPickTicketPdf } from "./print-ticket-pdf.js";
import { readPrintConfig } from "./print-config.js";

const config = { enabled: true, printer: "DEMO-QUEUE", pollMs: 5000, maxAttempts: 3, retryMs: 0 };
const ticket = { id: 1, requester_name: "Demo Requester", created_at: "2026-08-27 12:00:00", request_type: "issue", lines: [
  { manufacturing_order_id: "DEMO-MO-1", part_id: "DEMO-PART", item_description: "Demo bracket", requested_quantity: 4,
    on_hand_quantity: 100, inventory_abbreviation_code: "PARTS", default_inventory_location_id: "A-03",
    available_lots: [{ lot_number: "DEMO-LOT-1" }, { lot_number: "DEMO-LOT-2" }] },
] };
function setup(t, command, render = async () => Buffer.from("%PDF-test")) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE pick_tickets (id INTEGER PRIMARY KEY, status TEXT, cancelled_at TEXT); INSERT INTO pick_tickets VALUES(1, 'open', NULL)");
  t.after(() => db.close());
  const queue = createPrintQueue(db);
  queue.enqueue(ticket, config.printer);
  const worker = createPrintWorker({ queue, config, command, render, logger: { info() {}, error() {} } });
  return { db, queue, worker };
}
const accepting = { stdout: "DEMO-QUEUE accepting requests since Thu" };

test("printing is opt-in and invalid queue names cannot become options", () => {
  assert.equal(readPrintConfig({}).enabled, false);
  for (const printer of ["", "-d evil", "queue;whoami", "queue/name"]) {
    assert.throws(() => readPrintConfig({ AUTO_PRINT_ENABLED: "true", CUPS_PRINTER: printer }));
  }
});

test("one receipt, no duplicate polling submissions, no shell, temporary PDF removed", async t => {
  const calls = [];
  let filename;
  const { queue, worker } = setup(t, async (program, args) => {
    calls.push({ program, args });
    if (program === "lpstat") return accepting;
    filename = args.at(-1);
    assert.equal((await readFile(filename)).toString(), "%PDF-test");
    assert.equal(args[args.indexOf("-n") + 1], "1");
    assert.equal(args[args.indexOf("-d") + 1], "DEMO-QUEUE");
    return { stdout: "request id is DEMO-QUEUE-42 (1 file(s))" };
  });
  await Promise.all([worker.runOnce(), worker.runOnce()]);
  await worker.runOnce();
  assert.equal(calls.filter(call => call.program === "lp").length, 1);
  assert.equal(queue.status(1).job.status, "submitted");
  assert.equal(queue.status(1).job.cups_request_id, "DEMO-QUEUE-42");
  await assert.rejects(access(filename));
});

test("preflight failures retry three times then stop without submitting", async t => {
  const { worker, queue } = setup(t, async program => {
    assert.equal(program, "lpstat");
    throw new Error("CUPS unavailable");
  });
  for (let i = 0; i < 4; i++) await worker.runOnce();
  assert.equal(queue.status(1).job.status, "failed");
  assert.equal(queue.status(1).job.attempts, 3);
});

test("ambiguous submission and malformed receipts never retry automatically", async t => {
  for (const result of [null, { stdout: "unrecognized receipt" }]) {
    let submits = 0;
    const { worker, queue } = setup(t, async program => {
      if (program === "lpstat") return accepting;
      submits++;
      if (!result) throw new Error("connection lost after possible acceptance");
      return result;
    });
    await worker.runOnce();
    await worker.runOnce();
    assert.equal(submits, 1);
    assert.equal(queue.status(1).job.status, "uncertain");
  }
});

test("recovery preserves submitted work and flags interrupted submissions", t => {
  const { queue } = setup(t);
  const job = queue.claim();
  queue.recover();
  assert.equal(queue.status(1).job.status, "queued");
  queue.claim();
  queue.beginSubmission(job.id);
  queue.recover();
  assert.equal(queue.status(1).job.status, "uncertain");
  assert.equal(queue.claim(), null);
  queue.finish(job.id, "submitted", { requestId: "DEMO-QUEUE-1" });
  queue.recover();
  assert.equal(queue.status(1).job.status, "submitted");
});

test("closed or cancelled tickets are not submitted; queue deletion cannot resurrect work", async t => {
  for (const sql of ["UPDATE pick_tickets SET status = 'closed'", "UPDATE pick_tickets SET cancelled_at = 'now'", "DELETE FROM pick_tickets"]) {
    const { db, queue, worker } = setup(t, async program => { assert.equal(program, "lpstat"); return accepting; }, async () => {
      db.exec(sql);
      return Buffer.from("%PDF-test");
    });
    await worker.runOnce();
    assert.ok(queue.status(1).job === null || queue.status(1).job.status === "skipped");
  }
});

test("PDF generation includes a landscape page and paginates long rows without truncating", async () => {
  const pdf = await renderPickTicketPdf({ ...ticket, lines: [
    ...ticket.lines, { ...ticket.lines[0], item_description: "A very long description ".repeat(250),
      available_lots: Array.from({ length: 90 }, (_, i) => ({ lot_number: `LOT-${i}` })) },
  ] });
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-"));
  assert.match(text, /\/MediaBox \[0 0 792 612\]/);
  assert.ok((text.match(/\/Type \/Page\b/g) ?? []).length >= 3);
});
