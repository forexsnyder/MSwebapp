import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";

const widths = [78, 148, 136, 52, 46, 68, 68, 140];
const headers = ["MO#", "Part ID - Item Description", "Description", "Requested", "On Hand", "Inv. ABBREV", "Location", "Lot # / Qty Issued"];

export function renderPickTicketPdf(ticket) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 28, bufferPages: true,
      info: { Title: `TICKET-${String(ticket.id).padStart(6, "0")}`, Author: "MSI Picker" } });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    try {
      const font = [process.env.PRINT_FONT_PATH, "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:/Windows/Fonts/arial.ttf"]
        .find(candidate => candidate && existsSync(candidate));
      if (!font) throw new Error("Install fonts-dejavu-core or set PRINT_FONT_PATH to a Unicode TTF font.");
      doc.font(font);
      const clean = value => String(value ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "");
      // Wrap even long part identifiers; split over-height rows across pages instead of clipping them.
      function wrap(value, width, size = 8) {
        doc.fontSize(size);
        const output = [];
        for (const paragraph of clean(value).split("\n")) {
          let line = "";
          for (const word of paragraph.split(/\s+/)) {
            if (line && doc.widthOfString(`${line} ${word}`) <= width) { line += ` ${word}`; continue; }
            if (line) { output.push(line); line = ""; }
            for (const character of word) {
              if (line && doc.widthOfString(line + character) > width) { output.push(line); line = ""; }
              line += character;
            }
          }
          output.push(line);
        }
        return output;
      }
      let y;
      let tableTop;
      function pageHeader() {
        y = 28;
        doc.fontSize(16).fillColor("#111827").text(`TICKET-${String(ticket.id).padStart(6, "0")}`, 28, y);
        y += 27;
        for (const line of wrap(`${String(ticket.request_type).toUpperCase()}  |  Requester: ${ticket.requester_name}  |  Created: ${ticket.created_at}`, 736, 9)) {
          doc.fontSize(9).text(line, 28, y, { lineBreak: false }); y += 12;
        }
        y += 8;
        let x = 28;
        headers.forEach((header, i) => {
          doc.rect(x, y, widths[i], 30).fillAndStroke("#e5e7eb", "#9ca3af");
          doc.fillColor("#111827").fontSize(8).text(header, x + 4, y + 5, { width: widths[i] - 8, height: 23 });
          x += widths[i];
        });
        y += 30;
        tableTop = y;
      }
      pageHeader();
      for (const line of ticket.lines) {
        const lots = (line.available_lots ?? []).map(lot => `${lot.lot_number}   Qty: ________`).join("\n") || "Lot: __________  Qty: ________";
        const values = [line.manufacturing_order_id, line.part_id_item_description || line.part_id,
          line.item_description || "No item description", line.requested_quantity, line.on_hand_quantity,
          line.inventory_abbreviation_code, line.default_inventory_location_id, lots];
        const cells = values.map((value, i) => wrap(value, widths[i] - 8));
        let offset = 0;
        const total = Math.max(...cells.map(cell => cell.length), 2);
        const rowHeight = total * 11 + 8;
        if (rowHeight <= 566 - tableTop && y + rowHeight > 566) { doc.addPage(); pageHeader(); }
        while (offset < total) {
          if (y + 32 > 566) { doc.addPage(); pageHeader(); }
          const count = Math.min(total - offset, Math.floor((566 - y - 8) / 11));
          if (count < 1) throw new Error("Ticket header is too large to fit on a page.");
          const height = count * 11 + 8;
          let x = 28;
          cells.forEach((cell, i) => {
            doc.rect(x, y, widths[i], height).strokeColor("#9ca3af").stroke();
            const section = offset > 0 && i < 2 && offset >= cell.length ? cell.slice(0, count) : cell.slice(offset, offset + count);
            section.forEach((text, row) => {
              doc.fontSize(8).fillColor("#111827").text(text, x + 4, y + 4 + row * 11, { lineBreak: false });
            });
            x += widths[i];
          });
          y += height;
          offset += count;
        }
      }
      const pages = doc.bufferedPageRange();
      for (let page = 0; page < pages.count; page++) {
        doc.switchToPage(page);
        doc.fontSize(8).fillColor("#4b5563").text(`Pick ticket - quantities and locations captured when requested.     Page ${page + 1} of ${pages.count}`, 28, 583, { lineBreak: false });
      }
      doc.end();
    } catch (error) { doc.destroy(); reject(error); }
  });
}
