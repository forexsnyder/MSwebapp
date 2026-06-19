import type { PickTicket, PickTicketLine } from "../types";

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatTicketRef(id: number) {
  return `TICKET-${String(id).padStart(6, "0")}`;
}

const PICK_LINE_HEADERS = [
  "MO#",
  "Part #",
  "Rev ID",
  "Requested",
  "On Hand",
  "Inv. ABBREV",
  "Location",
  "Lot #",
] as const;

function lotDisplayForLine(
  ln: PickTicketLine,
  ticketStatus: PickTicket["status"],
  lotByLineId?: Record<number, string>,
) {
  if (ticketStatus === "open") {
    return lotByLineId?.[ln.id] ?? "";
  }
  return lotByLineId?.[ln.id] ?? ln.lot_number?.trim() ?? "";
}

function renderPickLineRow(ln: PickTicketLine, lotDisplay: string) {
  return `
    <tr>
      <td class="mono">${escapeHtml(ln.manufacturing_order_id)}</td>
      <td class="mono">${escapeHtml(ln.part_id)}</td>
      <td class="mono">${escapeHtml(ln.part_revision_id)}</td>
      <td>${ln.requested_quantity}</td>
      <td>${ln.on_hand_quantity}</td>
      <td class="mono">${escapeHtml(ln.inventory_abbreviation_code)}</td>
      <td class="mono">${escapeHtml(ln.default_inventory_location_id)}</td>
      <td class="lot-blank">${escapeHtml(lotDisplay)}</td>
    </tr>`;
}

function renderLinesTable(
  lines: PickTicketLine[],
  ticketStatus: PickTicket["status"],
  lotByLineId?: Record<number, string>,
) {
  const headerRow = PICK_LINE_HEADERS.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const bodyRows = lines
    .map((ln) => renderPickLineRow(ln, lotDisplayForLine(ln, ticketStatus, lotByLineId)))
    .join("");

  return `
    <table class="pick-lines-table">
      <thead><tr>${headerRow}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
}

function renderTicketBody(ticket: PickTicket, lotByLineId?: Record<number, string>) {
  const typeLabel = ticket.request_type.toUpperCase();
  const mo = ticket.manufacturing_order_id || "—";
  const statusExtra =
    ticket.status === "closed" && ticket.closed_by
      ? ` · <strong>Picked by:</strong> ${escapeHtml(ticket.closed_by)} · <strong>Closed:</strong> ${escapeHtml(ticket.closed_at ?? "—")}`
      : ticket.status === "cancelled"
        ? ` · <strong>Cancelled by:</strong> ${escapeHtml(ticket.cancelled_by ?? "—")}`
        : "";

  const linesTable = renderLinesTable(ticket.lines, ticket.status, lotByLineId);

  return `
  <article class="pick-ticket-print">
    <h2>${escapeHtml(formatTicketRef(ticket.id))}</h2>
    <p class="meta">
      <strong>Type:</strong> ${escapeHtml(typeLabel)} ·
      <strong>MO:</strong> <span class="mono">${escapeHtml(mo)}</span> ·
      <strong>Requester:</strong> ${escapeHtml(ticket.requester_name)} ·
      <strong>Created:</strong> ${escapeHtml(ticket.created_at)}${statusExtra}
    </p>
    ${linesTable}
  </article>`;
}

const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 1rem; color: #0f172a; }
  h1 { font-size: 1.35rem; margin: 0 0 1rem; }
  h2 { font-size: 1.15rem; margin: 0 0 0.35rem; }
  .meta { font-size: 0.9rem; color: #475569; margin: 0 0 0.75rem; }
  .meta strong { color: #0f172a; }
  .pick-ticket-print { margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 2px solid #cbd5e1; }
  .pick-ticket-print:last-child { border-bottom: none; }
  .pick-lines-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 0.5rem; }
  th, td { border: 1px solid #cbd5e1; padding: 0.4rem 0.5rem; text-align: left; vertical-align: middle; }
  th { background: #e2e8f0; font-size: 0.8rem; }
  .mono { font-family: ui-monospace, monospace; font-size: 0.8rem; }
  .lot-blank {
    min-width: 5rem;
    min-height: 2rem;
    background: #fff;
  }
  @media print {
    body { margin: 0.5in; }
    .pick-ticket-print { page-break-after: always; border-bottom: none; }
    .pick-ticket-print:last-child { page-break-after: auto; }
    tr { page-break-inside: avoid; }
  }
`;

let printFrame: HTMLIFrameElement | null = null;

/** Print via a hidden iframe — avoids pop-up blockers and blank tabs. */
function printHtmlDocument(html: string) {
  if (!printFrame) {
    printFrame = document.createElement("iframe");
    printFrame.setAttribute("title", "Pick ticket print");
    printFrame.setAttribute("aria-hidden", "true");
    printFrame.style.cssText =
      "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;right:0;bottom:0";
    document.body.appendChild(printFrame);
  }

  const win = printFrame.contentWindow;
  const doc = printFrame.contentDocument ?? win?.document;
  if (!win || !doc) {
    throw new Error("Could not open the print preview.");
  }

  doc.open();
  doc.write(html);
  doc.close();

  const runPrint = () => {
    win.focus();
    win.print();
  };

  // Allow layout/paint before opening the system print dialog.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(runPrint, 150);
    });
  });
}

export type PrintPickTicketOptions = {
  title?: string;
  autoPrint?: boolean;
  /** Per-line lot values (e.g. from picker handwrite fields). Open tickets print blank lots when omitted. */
  lotByLineId?: Record<number, string>;
};

export function printPickTicket(ticket: PickTicket, options: PrintPickTicketOptions = {}) {
  printPickTickets([ticket], options);
}

export function printPickTickets(tickets: PickTicket[], options: PrintPickTicketOptions = {}) {
  const { title, autoPrint = true, lotByLineId } = options;
  if (tickets.length === 0) {
    throw new Error("No tickets to print.");
  }

  const docTitle = title ?? (tickets.length === 1 ? formatTicketRef(tickets[0].id) : `${tickets.length} pick tickets`);
  const heading = tickets.length === 1 ? "" : `<h1>${escapeHtml(docTitle)}</h1>`;
  const bodies = tickets.map((t) => renderTicketBody(t, lotByLineId)).join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(docTitle)}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  ${heading}
  ${bodies}
</body>
</html>`;

  if (autoPrint) {
    printHtmlDocument(html);
  }
}
