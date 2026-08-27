import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPickTicketPdf } from "./print-ticket-pdf.js";

const exec = promisify(execFile);
export function cupsCommand(program, args) {
  return exec(program, args, {
    timeout: 30000, maxBuffer: 128 * 1024, windowsHide: true,
    env: { ...process.env, LC_ALL: "C", LANG: "C", CUPS_SERVER: "localhost" },
  });
}

export function createPrintWorker({ queue, config, command = cupsCommand, render = renderPickTicketPdf, logger = console }) {
  let running = false;
  let timer;
  let stopped = false;
  async function runOnce() {
    if (!config.enabled || running || stopped) return;
    running = true;
    let job;
    let directory;
    let submitting = false;
    try {
      job = queue.claim();
      if (!job) return;
      // Check the configured local queue before generating or submitting any document.
      const accepting = await command("lpstat", ["-h", "localhost", "-a", job.printer]);
      if (!accepting.stdout.split(/\r?\n/).some(line => line.startsWith(`${job.printer} accepting requests`))) {
        throw new Error("Printer queue is not accepting jobs.");
      }
      const pdf = await render(JSON.parse(job.snapshot_json));
      directory = await mkdtemp(join(tmpdir(), "mswebapp-print-"));
      const file = join(directory, "ticket.pdf");
      await writeFile(file, pdf, { mode: 0o600 });
      if (stopped || !queue.beginSubmission(job.id)) {
        queue.finish(job.id, stopped ? "queued" : "skipped");
        return;
      }
      submitting = true;
      // No shell. Destination and options are server-controlled, never supplied by a request.
      const result = await command("lp", ["-h", "localhost", "-d", job.printer,
        "-n", "1", "-o", "media=Letter", "-o", "sides=one-sided",
        "-o", "job-sheets=none", "-t", `MSI-TICKET-${job.pick_ticket_id}-JOB-${job.id}`, "--", file]);
      const requestId = /request id is (\S+-\d+)\s/.exec(`${result.stdout}\n`)?.[1];
      if (!requestId || !requestId.startsWith(`${job.printer}-`)) {
        throw new Error("CUPS did not return a recognizable job receipt.");
      }
      queue.finish(job.id, "submitted", { requestId });
      logger.info(`Print job ${job.id} submitted as ${requestId}.`);
    } catch (error) {
      if (!job) { logger.error("Could not access automatic print queue."); return; }
      // ENOENT/EACCES means lp never launched. Other submission failures might have reached CUPS.
      const uncertain = submitting && !["ENOENT", "EACCES"].includes(error.code);
      const retry = !uncertain && job.attempts < config.maxAttempts;
      const status = uncertain ? "uncertain" : retry ? "queued" : "failed";
      queue.finish(job.id, status, {
        error: uncertain
          ? "Submission outcome is uncertain. Check CUPS and the printer before manually reprinting."
          : "Could not prepare or submit the print job. Check CUPS, the queue, and the server print dependencies.",
        availableAt: retry ? Date.now() + config.retryMs * job.attempts : 0,
      });
      logger.error(`Print job ${job.id}: ${status}.`);
    } finally {
      if (directory) {
        await unlink(join(directory, "ticket.pdf")).catch(() => {});
        await rmdir(directory).catch(() => {});
      }
      running = false;
    }
  }
  return {
    runOnce,
    start() {
      if (!config.enabled || timer) return;
      queue.recover();
      void runOnce();
      timer = setInterval(() => void runOnce(), config.pollMs);
      timer.unref();
    },
    stop() { stopped = true; clearInterval(timer); },
  };
}
