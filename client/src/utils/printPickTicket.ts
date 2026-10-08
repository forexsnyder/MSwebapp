import type { PickTicket, PickTicketLine } from "../types";

function escapeHtml(value: unknown) {
  return String(value ?? "")
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
  "Part ID - Item Description",
  "Description",
  "Requested",
  "On Hand",
  "Inv. ABBREV",
  "Location",
  "Lot # / Qty Issued",
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

function renderPickLineRow(ln: PickTicketLine, lotDisplayHtml: string) {
  return `
    <tr>
      <td class="mono">${escapeHtml(ln.manufacturing_order_id)}</td>
      <td class="part-description">${escapeHtml(ln.part_id_item_description || ln.part_id)}</td>
      <td>${escapeHtml(ln.item_description || "No item description")}</td>
      <td>${ln.requested_quantity}</td>
      <td>${ln.on_hand_quantity}</td>
      <td class="mono">${escapeHtml(ln.inventory_abbreviation_code)}</td>
      <td class="mono">${escapeHtml(ln.default_inventory_location_id)}</td>
      <td class="lot-blank">${lotDisplayHtml}</td>
    </tr>`;
}

function renderLinesTable(
  lines: PickTicketLine[],
  ticketStatus: PickTicket["status"],
  lotByLineId?: Record<number, string>,
  lotOptionsByLineId?: Record<number, string[]>,
  lotQuantitiesByLineId?: Record<number, Record<string, string>>,
) {
  const headerRow = PICK_LINE_HEADERS.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const bodyRows = lines
    .map((ln) => {
      const lotOptions = lotOptionsByLineId?.[ln.id] ?? (ln.available_lots ?? []).map((lot) => lot.lot_number);
      const quantities = lotQuantitiesByLineId?.[ln.id] ?? {};
      const lotDisplayHtml =
        ticketStatus === "open" && lotOptions.length > 0
          ? `<div class="lot-list">${lotOptions
              .map(
                (lot) =>
                  `<div class="lot-row"><span class="mono">${escapeHtml(lot)}</span><span class="lot-qty-box">${escapeHtml(quantities[lot] ?? "")}</span></div>`,
              )
              .join("")}</div>`
          : escapeHtml(lotDisplayForLine(ln, ticketStatus, lotByLineId));
      return renderPickLineRow(ln, lotDisplayHtml);
    })
    .join("");

  return `
    <table class="pick-lines-table">
      <thead><tr>${headerRow}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
}

function renderTicketBody(
  ticket: PickTicket,
  lotByLineId?: Record<number, string>,
  lotOptionsByLineId?: Record<number, string[]>,
  lotQuantitiesByLineId?: Record<number, Record<string, string>>,
) {
  const typeLabel = ticket.request_type.toUpperCase();
  const typeClass = ticket.request_type === "return" || ticket.request_type === "scrap"
    ? ` pick-ticket-print--${ticket.request_type}`
    : "";
  const typeMarker = ticket.request_type === "issue"
    ? ""
    : `<div class="ticket-type-marker">${escapeHtml(typeLabel)} — DO NOT PROCESS AS ISSUE</div>`;
  const nonPickNotice = ticket.request_type === "issue"
    ? ""
    : `<p class="do-not-pick"><strong>DO NOT PICK</strong> — ${escapeHtml(typeLabel)} transaction. Complete this ${escapeHtml(typeLabel.toLowerCase())} transaction according to procedure.</p>`;
  const mo = ticket.manufacturing_order_id || "—";
  const statusExtra =
    ticket.status === "closed" && ticket.closed_by
      ? ` · <strong>Picked by:</strong> ${escapeHtml(ticket.closed_by)} · <strong>Closed:</strong> ${escapeHtml(ticket.closed_at ?? "—")}`
      : ticket.status === "cancelled"
        ? ` · <strong>Cancelled by:</strong> ${escapeHtml(ticket.cancelled_by ?? "—")}`
        : "";

  const linesTable = renderLinesTable(
    ticket.lines,
    ticket.status,
    lotByLineId,
    lotOptionsByLineId,
    lotQuantitiesByLineId,
  );

  return `
  <article class="pick-ticket-print${typeClass}">
    <h2>${escapeHtml(formatTicketRef(ticket.id))}</h2>
    ${typeMarker}
    <p class="meta">
      <strong>Type:</strong> ${escapeHtml(typeLabel)} ·
      <strong>MO:</strong> <span class="mono">${escapeHtml(mo)}</span> ·
      <strong>Requester:</strong> ${escapeHtml(ticket.requester_name)} ·
      <strong>Created:</strong> ${escapeHtml(ticket.created_at)}${statusExtra}
    </p>
    ${nonPickNotice}
    ${linesTable}
  </article>`;
}

const PRINT_STYLES = `
  @page { size: landscape; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 1rem; color: #0f172a; }
  h1 { font-size: 1.35rem; margin: 0 0 1rem; }
  h2 { font-size: 1.15rem; margin: 0 0 0.35rem; }
  .meta { font-size: 0.9rem; color: #475569; margin: 0 0 0.75rem; }
  .meta strong { color: #0f172a; }
  .do-not-pick { margin: 0 0 0.75rem; padding: 0.55rem 0.7rem; color: #9a3412; background: #fff7ed; border: 2px solid #f97316; font-size: 1rem; }
  .do-not-pick strong { color: #991b1b; letter-spacing: 0.04em; }
  .pick-ticket-print { margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 2px solid #cbd5e1; }
  .pick-ticket-print--return { border: 5px double #111827; padding: 0.75rem; }
  .pick-ticket-print--scrap { border: 5px dashed #111827; padding: 0.75rem; }
  .pick-ticket-print--return:last-child { border-bottom: 5px double #111827; }
  .pick-ticket-print--scrap:last-child { border-bottom: 5px dashed #111827; }
  .ticket-type-marker { margin: 0 0 0.75rem; padding: 0.45rem 0.65rem; border: 3px solid #111827; font-size: 1.1rem; font-weight: 900; letter-spacing: 0.08em; text-align: center; }
  .pick-ticket-print:last-child { border-bottom: none; }
  .pick-lines-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 0.5rem; }
  th, td { border: 1px solid #cbd5e1; padding: 0.4rem 0.5rem; text-align: left; vertical-align: middle; }
  th { background: #e2e8f0; font-size: 0.8rem; }
  .mono { font-family: ui-monospace, monospace; font-size: 0.8rem; }
  .part-description { min-width: 10rem; overflow-wrap: anywhere; }
  .lot-blank {
    min-width: 5rem;
    min-height: 2rem;
    background: #fff;
  }
  .lot-list { display: grid; gap: 0.3rem; min-width: 8rem; }
  .lot-row { display: grid; grid-template-columns: minmax(2.5rem, 1fr) 3.5rem; align-items: center; gap: 0.45rem; }
  .lot-qty-box { display: block; min-width: 3.5rem; min-height: 1.65rem; padding: 0.2rem; border: 1.5px solid #64748b; border-radius: 0.2rem; background: #fff; }
  @media print {
    body { margin: 0.5in; }
    .pick-ticket-print { page-break-after: always; }
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
  /** Available lots and optional entered quantities for rendering picker boxes on open tickets. */
  lotOptionsByLineId?: Record<number, string[]>;
  lotQuantitiesByLineId?: Record<number, Record<string, string>>;
};

export function printPickTicket(ticket: PickTicket, options: PrintPickTicketOptions = {}) {
  printPickTickets([ticket], options);
}

export function printPickTickets(tickets: PickTicket[], options: PrintPickTicketOptions = {}) {
  const {
    title,
    autoPrint = true,
    lotByLineId,
    lotOptionsByLineId,
    lotQuantitiesByLineId,
  } = options;
  if (tickets.length === 0) {
    throw new Error("No tickets to print.");
  }

  const docTitle = title ?? (tickets.length === 1 ? formatTicketRef(tickets[0].id) : `${tickets.length} pick tickets`);
  const heading = tickets.length === 1 ? "" : `<h1>${escapeHtml(docTitle)}</h1>`;
  const bodies = tickets
    .map((t) => renderTicketBody(t, lotByLineId, lotOptionsByLineId, lotQuantitiesByLineId))
    .join("");

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
