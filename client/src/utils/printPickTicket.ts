import type { PickTicket } from "../types";

export type PrintPickTicketOptions = {
  title?: string;
  autoPrint?: boolean;
  lotByLineId?: Record<number, string>;
  lotOptionsByLineId?: Record<number, string[]>;
  lotQuantitiesByLineId?: Record<number, Record<string, string>>;
};

let printFrame: HTMLIFrameElement | null = null;
let printUrl: string | null = null;

export function printPickTicket(ticket: PickTicket, options: PrintPickTicketOptions = {}) {
  return printPickTickets([ticket], options);
}

export async function printPickTickets(tickets: PickTicket[], options: PrintPickTicketOptions = {}) {
  if (!tickets.length) throw new Error("No tickets to print.");
  const response = await fetch("/api/printing/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickets: tickets.map(ticket => ({
      ...ticket,
      lines: ticket.lines.map(line => ({
        ...line,
        lot_number: options.lotByLineId?.[line.id] ?? line.lot_number,
        available_lots: options.lotOptionsByLineId?.[line.id]?.map(lot_number => ({ lot_number })) ?? line.available_lots,
        print_lot_quantities: options.lotQuantitiesByLineId?.[line.id],
      })),
    })) }),
  });
  if (!response.ok) throw new Error("Could not prepare the print PDF.");
  const blob = await response.blob();
  printFrame?.remove();
  if (printUrl) URL.revokeObjectURL(printUrl);
  printUrl = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  printFrame = frame;
  frame.title = options.title ?? "Pick ticket print";
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  frame.onload = () => {
    if (options.autoPrint === false) return;
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  };
  frame.src = printUrl;
  document.body.appendChild(frame);
}
