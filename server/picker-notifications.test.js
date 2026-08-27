import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// Never touch the developer's or production database.
process.env.DB_PATH = ":memory:";
const {
  cancelPickTicket, clearPickQueue, closePickTicket, createPickTicket, getPickTicket,
  importManufacturingOrdersCsv, importInventoryCsv, listNotifications, listParts, listPickerNotifications,
  markNotificationsRead, markPickerNotificationsRead, resetDatabase,
} = await import("./db.js");

let partId;
beforeEach(() => {
  resetDatabase();
  importInventoryCsv({
    actor: "Test",
    csvText: "part_id,part_revision_id,item_description,on_hand_quantity,inventory_abbreviation_code,default_inventory_location_id,manufacturing_order_id,component_order_id,component_part_id,component_part_revision_id,to_issue_quantity,mo_status_code_description,lot_number\nPART-1,A,Test part,100,MAIN,A1,MO-1,CO-1,PART-1,A,1,In Shop,LOT-1",
  });
  importManufacturingOrdersCsv({
    actor: "Test",
    csvText: "manufacturing_order_id,component_order_id,component_part_id,component_part_revision_id,part_id,part_revision_id,to_issue_quantity,mo_status_code_description\nMO-1,CO-1,PART-1,A,PART-1,A,1,In Shop",
  });
  partId = listParts()[0].id;
});

function create(requester_name = "Requester", request_type = "issue") {
  return createPickTicket({ requester_name, request_type, lines: [{ inventory_part_id: partId, manufacturing_order_id: "MO-1", component_part_id: "PART-1", requested_quantity: 1 }] });
}

test("new and existing open requests notify every picker without assignment", () => {
  const first = create();
  const second = create("Other requester", "return");
  for (const picker of ["Picker A", "Picker B"]) {
    const alerts = listPickerNotifications(picker);
    assert.deepEqual(alerts.map((item) => item.pick_ticket_id), [second.id, first.id]);
    assert.match(alerts[0].message, /New return request TICKET-000002 \(MO MO-1\) from Other requester/);
  }
  assert.equal(getPickTicket(first.id).closed_by, null);
});

test("dismissal is durable per user, idempotent, and does not close tickets", () => {
  const ticket = create();
  assert.deepEqual(markPickerNotificationsRead(" Picker A ", [ticket.id, ticket.id]), { updated: 1 });
  assert.deepEqual(markPickerNotificationsRead("picker a", [ticket.id]), { updated: 0 });
  assert.deepEqual(listPickerNotifications("PICKER A"), []);
  assert.equal(listPickerNotifications("Picker B").length, 1);
  assert.equal(getPickTicket(ticket.id).status, "open");
  const next = create();
  assert.deepEqual(listPickerNotifications("Picker A").map((item) => item.id), [next.id]);
});

test("a ticket arriving during dismissal is not marked read", () => {
  create();
  const displayedIds = listPickerNotifications("Picker").map((item) => item.id);
  const next = create();
  markPickerNotificationsRead("Picker", displayedIds);
  assert.deepEqual(listPickerNotifications("Picker").map((item) => item.id), [next.id]);
});

test("closed/cancelled tickets stop alerting and requester updates still work", () => {
  const completed = create();
  const cancelled = create();
  closePickTicket(completed.id, { picker_name: "Actual picker" });
  cancelPickTicket(cancelled.id, { cancelled_by: "Actual picker" });
  assert.deepEqual(listPickerNotifications("Picker"), []);
  assert.equal(getPickTicket(completed.id).closed_by, "Actual picker");
  const updates = listNotifications("Requester", { unreadOnly: true });
  assert.equal(updates.length, 2);
  assert.ok(updates.some((item) => item.message.includes("was picked by Actual picker")));
  markNotificationsRead("Requester", updates.map((item) => item.id));
  assert.deepEqual(listNotifications("Requester", { unreadOnly: true }), []);
});

test("queue/database clearing removes receipts, including before ticket ID reuse", () => {
  let ticket = create();
  markPickerNotificationsRead("Picker", [ticket.id]);
  clearPickQueue({ actor: "Test" });
  assert.deepEqual(listPickerNotifications("Picker"), []);
  ticket = create();
  assert.equal(listPickerNotifications("Picker")[0].id, ticket.id);
  resetDatabase();
  assert.deepEqual(listPickerNotifications("Picker"), []);
});

test("invalid/future IDs cannot hide future orders and user is required", () => {
  assert.throws(() => listPickerNotifications(" "), /recipient is required/);
  assert.throws(() => markPickerNotificationsRead(null, []), /recipient is required/);
  assert.throws(() => markPickerNotificationsRead("Picker", "1"), /ids must be an array/);
  assert.deepEqual(markPickerNotificationsRead("Picker", [1, -1, "no", 0, 1.5]), { updated: 0 });
  const ticket = create();
  assert.equal(listPickerNotifications("Picker")[0].id, ticket.id);
});
