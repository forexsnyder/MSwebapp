// Generates a fictional ticket only. Does not connect to a printer or the app database.
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderPickTicketPdf } from "./print-ticket-pdf.js";

const output = resolve(process.argv[2] ?? "sample-pick-ticket.pdf");
const ticket = {
  id: 1, requester_name: "DEMO REQUESTER - TEST PRINT ONLY", request_type: "issue", created_at: "2026-08-27 12:00:00",
  lines: Array.from({ length: 20 }, (_, i) => ({
    manufacturing_order_id: "DEMO-MO-1001", part_id: `DEMO-PART-${i + 1}`,
    part_id_item_description: `DEMO-PART-${i + 1} - Mounting bracket assembly`,
    item_description: "Demonstration part - not an actual order", requested_quantity: 4,
    on_hand_quantity: 100, inventory_abbreviation_code: "PARTS", default_inventory_location_id: `A-${i + 1}`,
    available_lots: [{ lot_number: "DEMO-LOT-A" }, { lot_number: "DEMO-LOT-B" }],
  })),
};
await writeFile(output, await renderPickTicketPdf(ticket));
console.log(output);
