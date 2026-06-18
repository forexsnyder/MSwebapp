import Database from "better-sqlite3";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultDataDir = join(__dirname, "data");
const envDbPath = process.env.DB_PATH ? String(process.env.DB_PATH) : "";
const dbPath = envDbPath.trim() || join(defaultDataDir, "app.db");
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    prev_entry_hash TEXT,
    entry_hash TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at);

  CREATE TABLE IF NOT EXISTS inventory_parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_id TEXT NOT NULL,
    part_revision_id TEXT NOT NULL,
    item_description TEXT NOT NULL DEFAULT '',
    on_hand_quantity INTEGER NOT NULL CHECK (on_hand_quantity >= 0),
    inventory_abbreviation_code TEXT NOT NULL,
    default_inventory_location_id TEXT NOT NULL,
    manufacturing_order_id TEXT NOT NULL,
    component_order_id TEXT NOT NULL,
    component_part_id TEXT NOT NULL,
    component_part_revision_id TEXT NOT NULL,
    to_issue_quantity INTEGER NOT NULL CHECK (to_issue_quantity >= 0),
    mo_status_code_description TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_parts_identity ON inventory_parts (
    part_id,
    part_revision_id,
    manufacturing_order_id,
    component_order_id,
    component_part_id,
    component_part_revision_id,
    mo_status_code_description
  );

  CREATE TABLE IF NOT EXISTS pick_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    requester_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    closed_at TEXT,
    closed_by TEXT
  );

  CREATE TABLE IF NOT EXISTS pick_ticket_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pick_ticket_id INTEGER NOT NULL REFERENCES pick_tickets(id) ON DELETE CASCADE,
    inventory_part_id INTEGER NOT NULL REFERENCES inventory_parts(id),
    requested_quantity INTEGER NOT NULL CHECK (requested_quantity >= 0),
    UNIQUE(pick_ticket_id, inventory_part_id)
  );
`);

function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function migrate() {
  // Legacy cleanup (older versions of this workspace).
  db.exec(`DROP TABLE IF EXISTS orders`);

  const invCols = tableColumns("inventory_parts");
  if (invCols.length > 0 && !invCols.includes("updated_at")) {
    db.exec(`ALTER TABLE inventory_parts ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))`);
  }
  if (invCols.length > 0 && !invCols.includes("item_description")) {
    db.exec(`ALTER TABLE inventory_parts ADD COLUMN item_description TEXT NOT NULL DEFAULT ''`);
    db.exec(
      `UPDATE inventory_parts
       SET item_description = 'Item description for ' || part_id
       WHERE trim(item_description) = ''`,
    );
  }
  // Ensure MO status descriptions contain "In Shop" (requested business rule).
  if (invCols.length > 0 && invCols.includes("mo_status_code_description")) {
    db.exec(`
      UPDATE inventory_parts
      SET mo_status_code_description =
        CASE
          WHEN instr(mo_status_code_description, 'In Shop') > 0 THEN mo_status_code_description
          WHEN trim(mo_status_code_description) = '' THEN 'In Shop'
          ELSE 'In Shop - ' || mo_status_code_description
        END
      WHERE instr(mo_status_code_description, 'In Shop') = 0
    `);
  }
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_parts_identity ON inventory_parts (
      part_id,
      part_revision_id,
      manufacturing_order_id,
      component_order_id,
      component_part_id,
      component_part_revision_id,
      mo_status_code_description
    )`,
  );

  const ticketCols = tableColumns("pick_tickets");
  if (ticketCols.length > 0 && !ticketCols.includes("status")) {
    db.exec(`ALTER TABLE pick_tickets ADD COLUMN status TEXT NOT NULL DEFAULT 'open'`);
  }
  if (ticketCols.length > 0 && !ticketCols.includes("closed_at")) {
    db.exec(`ALTER TABLE pick_tickets ADD COLUMN closed_at TEXT`);
  }
  if (ticketCols.length > 0 && !ticketCols.includes("closed_by")) {
    db.exec(`ALTER TABLE pick_tickets ADD COLUMN closed_by TEXT`);
  }
  if (ticketCols.length > 0 && !ticketCols.includes("request_type")) {
    db.exec(
      `ALTER TABLE pick_tickets ADD COLUMN request_type TEXT NOT NULL DEFAULT 'issue' CHECK (request_type IN ('issue','scrap','return'))`,
    );
  }
  if (ticketCols.length > 0 && !ticketCols.includes("manufacturing_order_id")) {
    db.exec(`ALTER TABLE pick_tickets ADD COLUMN manufacturing_order_id TEXT NOT NULL DEFAULT ''`);
  }
  if (ticketCols.length > 0 && !ticketCols.includes("cancelled_at")) {
    db.exec(`ALTER TABLE pick_tickets ADD COLUMN cancelled_at TEXT`);
  }
  if (ticketCols.length > 0 && !ticketCols.includes("cancelled_by")) {
    db.exec(`ALTER TABLE pick_tickets ADD COLUMN cancelled_by TEXT`);
  }

  const lineCols = tableColumns("pick_ticket_lines");
  if (lineCols.length > 0 && !lineCols.includes("lot_number")) {
    db.exec(`ALTER TABLE pick_ticket_lines ADD COLUMN lot_number TEXT NOT NULL DEFAULT ''`);
  }

  if (invCols.length > 0 && !invCols.includes("lot_number")) {
    db.exec(`ALTER TABLE inventory_parts ADD COLUMN lot_number TEXT NOT NULL DEFAULT ''`);
    db.exec(
      `UPDATE inventory_parts SET lot_number = 'LOT-' || printf('%04d', id) WHERE trim(lot_number) = ''`,
    );
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      recipient_name TEXT NOT NULL,
      pick_ticket_id INTEGER REFERENCES pick_tickets(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      read_at TEXT
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications (recipient_name, read_at, created_at)`,
  );
}

migrate();

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function canonicalJson(value) {
  // Deterministic encoding for hashing (stable keys).
  const seen = new WeakSet();
  const sorter = (_key, v) => {
    if (v && typeof v === "object") {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
      if (Array.isArray(v)) return v;
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = v[k];
      return out;
    }
    return v;
  };
  return JSON.stringify(value, sorter);
}

function appendAudit({ actor, action, entity, entity_id = null, payload }) {
  const a = String(actor ?? "").trim() || "unknown";
  const act = String(action ?? "").trim() || "unknown";
  const ent = String(entity ?? "").trim() || "unknown";
  const eid = entity_id === null || entity_id === undefined ? null : String(entity_id);
  const payload_json = canonicalJson(payload ?? {});
  const payload_hash = sha256Hex(payload_json);
  const prev = db.prepare(`SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1`).get();
  const prev_entry_hash = prev?.entry_hash ?? null;
  const created_at = new Date().toISOString();
  const entry_material = canonicalJson({
    created_at,
    actor: a,
    action: act,
    entity: ent,
    entity_id: eid,
    payload_hash,
    prev_entry_hash,
  });
  const entry_hash = sha256Hex(entry_material);

  const ins = db.prepare(
    `INSERT INTO audit_log (
       created_at, actor, action, entity, entity_id,
       payload_json, payload_hash, prev_entry_hash, entry_hash
     ) VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  ins.run(created_at, a, act, ent, eid, payload_json, payload_hash, prev_entry_hash, entry_hash);
  return { created_at, entry_hash, prev_entry_hash, payload_hash };
}

export function listParts() {
  return db
    .prepare(
      `SELECT
         id,
         part_id,
         part_revision_id,
         item_description,
         on_hand_quantity,
         inventory_abbreviation_code,
         default_inventory_location_id,
         manufacturing_order_id,
         component_order_id,
         component_part_id,
         component_part_revision_id,
         to_issue_quantity,
         mo_status_code_description,
         lot_number,
         updated_at
       FROM inventory_parts
       ORDER BY part_id, part_revision_id`,
    )
    .all();
}

export function resetInventory({ actor } = {}) {
  const a = String(actor ?? "").trim() || "unknown";
  const tx = db.transaction(() => {
    const before = db.prepare("SELECT COUNT(*) AS c FROM inventory_parts").get().c;
    const pickTicketsBefore = db.prepare("SELECT COUNT(*) AS c FROM pick_tickets").get().c;
    const pickTicketLinesBefore = db.prepare("SELECT COUNT(*) AS c FROM pick_ticket_lines").get().c;
    db.exec("DELETE FROM pick_ticket_lines;");
    db.exec("DELETE FROM pick_tickets;");
    db.exec("DELETE FROM inventory_parts;");
    const after = db.prepare("SELECT COUNT(*) AS c FROM inventory_parts").get().c;
    appendAudit({
      actor: a,
      action: "inventory_reset",
      entity: "inventory_parts",
      entity_id: null,
      payload: {
        before_count: before,
        after_count: after,
        pick_tickets_deleted: pickTicketsBefore,
        pick_ticket_lines_deleted: pickTicketLinesBefore,
      },
    });
    return {
      before_count: before,
      after_count: after,
      pick_tickets_deleted: pickTicketsBefore,
      pick_ticket_lines_deleted: pickTicketLinesBefore,
    };
  });
  return tx();
}

export function clearPickQueue({ actor } = {}) {
  const a = String(actor ?? "").trim() || "unknown";
  const tx = db.transaction(() => {
    const before = db.prepare("SELECT COUNT(*) AS c FROM pick_tickets").get().c;
    // Lines are ON DELETE CASCADE, but delete explicitly for clarity/compat.
    db.exec("DELETE FROM pick_ticket_lines;");
    db.exec("DELETE FROM pick_tickets;");
    const after = db.prepare("SELECT COUNT(*) AS c FROM pick_tickets").get().c;
    appendAudit({
      actor: a,
      action: "pick_queue_cleared",
      entity: "pick_tickets",
      entity_id: null,
      payload: { before_count: before, after_count: after },
    });
    return { before_count: before, after_count: after };
  });
  return tx();
}

export function clearAuditLog() {
  const before = db.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c;
  db.exec("DELETE FROM audit_log;");
  const after = db.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c;
  return { before_count: before, after_count: after };
}

export function resetDatabase() {
  const before = {
    inventory_parts: db.prepare("SELECT COUNT(*) AS c FROM inventory_parts").get().c,
    pick_tickets: db.prepare("SELECT COUNT(*) AS c FROM pick_tickets").get().c,
    pick_ticket_lines: db.prepare("SELECT COUNT(*) AS c FROM pick_ticket_lines").get().c,
    notifications: db.prepare("SELECT COUNT(*) AS c FROM notifications").get().c,
    audit_log: db.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c,
  };
  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM notifications;
      DELETE FROM pick_ticket_lines;
      DELETE FROM pick_tickets;
      DELETE FROM inventory_parts;
      DELETE FROM audit_log;
      DELETE FROM sqlite_sequence
      WHERE name IN ('notifications', 'pick_ticket_lines', 'pick_tickets', 'inventory_parts', 'audit_log');
    `);
    return {
      before,
      after: {
        inventory_parts: db.prepare("SELECT COUNT(*) AS c FROM inventory_parts").get().c,
        pick_tickets: db.prepare("SELECT COUNT(*) AS c FROM pick_tickets").get().c,
        pick_ticket_lines: db.prepare("SELECT COUNT(*) AS c FROM pick_ticket_lines").get().c,
        notifications: db.prepare("SELECT COUNT(*) AS c FROM notifications").get().c,
        audit_log: db.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c,
      },
    };
  });
  return tx();
}

export function listAuditLog({ limit = 200 } = {}) {
  const lim = Number(limit);
  const safe = Number.isInteger(lim) && lim > 0 && lim <= 2000 ? lim : 200;
  return db
    .prepare(
      `SELECT id, created_at, actor, action, entity, entity_id, payload_json, payload_hash, prev_entry_hash, entry_hash
       FROM audit_log
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(safe);
}

const pickTicketSummarySql = `
  SELECT
    t.id,
    t.created_at,
    t.requester_name,
    t.request_type,
    t.manufacturing_order_id,
    CASE WHEN t.cancelled_at IS NOT NULL THEN 'cancelled' ELSE t.status END AS status,
    t.closed_at,
    t.closed_by,
    t.cancelled_at,
    t.cancelled_by,
    (SELECT COUNT(*) FROM pick_ticket_lines l WHERE l.pick_ticket_id = t.id) AS line_count
  FROM pick_tickets t`;

function assertPickTicketActive(cur) {
  if (!cur) throw new Error("pick ticket not found");
  if (cur.cancelled_at) throw new Error("pick ticket is cancelled");
  if (cur.status === "closed") throw new Error("pick ticket is already closed");
}

function manufacturingOrderIdsForPartIds(inventoryPartIds) {
  const sel = db.prepare(`SELECT DISTINCT manufacturing_order_id FROM inventory_parts WHERE id = ?`);
  const mos = new Set();
  for (const id of inventoryPartIds) {
    const row = sel.get(id);
    if (row?.manufacturing_order_id) mos.add(row.manufacturing_order_id);
  }
  return [...mos].sort((a, b) => a.localeCompare(b)).join(", ");
}

function formatTicketRef(id) {
  return `TICKET-${String(id).padStart(6, "0")}`;
}

export function listPickTickets({ includeCancelled = false, status, q } = {}) {
  const parts = [];
  const params = [];

  if (!includeCancelled) {
    parts.push(`t.cancelled_at IS NULL`);
  }

  if (status === "closed") {
    parts.push(`t.status = 'closed'`);
  } else if (status === "open") {
    parts.push(`t.status = 'open'`);
  }

  const query = String(q ?? "").trim().toLowerCase();
  if (query) {
    const pattern = `%${query}%`;
    const idDigits = query.replace(/\D/g, "");
    parts.push(`(
      lower(trim(t.requester_name)) LIKE ?
      OR lower(trim(coalesce(t.closed_by, ''))) LIKE ?
      OR lower(trim(coalesce(t.cancelled_by, ''))) LIKE ?
      OR lower(trim(coalesce(t.manufacturing_order_id, ''))) LIKE ?
      OR lower(trim(coalesce(t.created_at, ''))) LIKE ?
      OR lower(trim(coalesce(t.closed_at, ''))) LIKE ?
      OR lower(printf('ticket-%06d', t.id)) LIKE ?
      OR lower(cast(t.id AS TEXT)) LIKE ?
      OR EXISTS (
        SELECT 1
        FROM pick_ticket_lines sl
        JOIN inventory_parts sp ON sp.id = sl.inventory_part_id
        WHERE sl.pick_ticket_id = t.id
          AND (
            lower(trim(sp.manufacturing_order_id)) LIKE ?
            OR lower(trim(sp.component_part_id)) LIKE ?
            OR lower(trim(sp.part_id)) LIKE ?
            OR lower(trim(coalesce(sp.item_description, ''))) LIKE ?
            OR lower(trim(coalesce(sl.lot_number, ''))) LIKE ?
            OR lower(trim(coalesce(sp.lot_number, ''))) LIKE ?
          )
      )
      ${idDigits ? `OR cast(t.id AS TEXT) LIKE ?` : ""}
    )`);
    params.push(
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
    );
    if (idDigits) params.push(`%${idDigits}%`);
  }

  const where = parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
  const order =
    status === "closed"
      ? `datetime(t.closed_at) DESC, t.id DESC`
      : `datetime(t.created_at) DESC, t.id DESC`;

  return db
    .prepare(`${pickTicketSummarySql}${where} ORDER BY ${order}`)
    .all(...params);
}

export function listUserPickTicketHistory(username) {
  const u = String(username ?? "").trim();
  if (!u) throw new Error("user is required");
  const requested = db
    .prepare(
      `${pickTicketSummarySql}
       WHERE lower(trim(t.requester_name)) = lower(?)
       ORDER BY datetime(t.created_at) DESC, t.id DESC`,
    )
    .all(u);
  const picked = db
    .prepare(
      `${pickTicketSummarySql}
       WHERE t.status = 'closed' AND lower(trim(t.closed_by)) = lower(?)
       ORDER BY datetime(t.closed_at) DESC, t.id DESC`,
    )
    .all(u);
  return { requested, picked };
}

export function getPickTicket(id) {
  const ticket = db
    .prepare(
      `SELECT
         id,
         created_at,
         requester_name,
         request_type,
         manufacturing_order_id,
         CASE WHEN cancelled_at IS NOT NULL THEN 'cancelled' ELSE status END AS status,
         closed_at,
         closed_by,
         cancelled_at,
         cancelled_by
       FROM pick_tickets WHERE id = ?`,
    )
    .get(id);
  if (!ticket) return null;
  const lines = db
    .prepare(
      `SELECT
         l.id,
         l.inventory_part_id,
         l.requested_quantity,
         l.lot_number,
         p.part_id,
         p.part_revision_id,
         p.item_description,
         p.on_hand_quantity,
         p.inventory_abbreviation_code,
         p.default_inventory_location_id,
         p.manufacturing_order_id,
         p.component_order_id,
         p.component_part_id,
         p.component_part_revision_id,
         p.to_issue_quantity,
         p.mo_status_code_description,
         p.lot_number AS inventory_lot_number
       FROM pick_ticket_lines l
       JOIN inventory_parts p ON p.id = l.inventory_part_id
       WHERE l.pick_ticket_id = ?
       ORDER BY l.id ASC`,
    )
    .all(id);
  return {
    ...ticket,
    lines: lines.map((ln) => ({
      ...ln,
      lot_number: String(ln.lot_number || ln.inventory_lot_number || "").trim(),
    })),
  };
}

export function createPickTicket({ requester_name, request_type, lines }) {
  const requester = String(requester_name ?? "").trim();
  if (!requester) throw new Error("requester_name is required");
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("lines are required");
  const typeRaw = String(request_type ?? "issue").trim().toLowerCase();
  const requestType = ["issue", "scrap", "return"].includes(typeRaw) ? typeRaw : "issue";

  const normalized = lines.map((ln) => {
    const inventory_part_id = Number(ln?.inventory_part_id);
    const requested_quantity = Number(ln?.requested_quantity);
    if (!Number.isInteger(inventory_part_id) || inventory_part_id < 1) {
      throw new Error("invalid inventory_part_id");
    }
    if (!Number.isInteger(requested_quantity) || requested_quantity < 0) {
      throw new Error("requested_quantity must be a whole number ≥ 0");
    }
    return { inventory_part_id, requested_quantity };
  });

  const manufacturing_order_id = manufacturingOrderIdsForPartIds(
    normalized.map((ln) => ln.inventory_part_id),
  );

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO pick_tickets (requester_name, request_type, manufacturing_order_id) VALUES (?, ?, ?)`,
      )
      .run(requester, requestType, manufacturing_order_id);
    const ticketId = info.lastInsertRowid;
    const insLine = db.prepare(
      `INSERT INTO pick_ticket_lines (pick_ticket_id, inventory_part_id, requested_quantity, lot_number)
       VALUES (?,?,?,?)`,
    );
    const invRow = db.prepare(
      `SELECT id, lot_number FROM inventory_parts WHERE id = ?`,
    );
    for (const ln of normalized) {
      const inv = invRow.get(ln.inventory_part_id);
      if (!inv) throw new Error(`inventory_part_id not found: ${ln.inventory_part_id}`);
      const lot = String(inv.lot_number ?? "").trim();
      insLine.run(ticketId, ln.inventory_part_id, ln.requested_quantity, lot);
    }
    return ticketId;
  });

  const ticketId = tx();
  const ticket = getPickTicket(ticketId);
  appendAudit({
    actor: requester,
    action: "pick_ticket_created",
    entity: "pick_ticket",
    entity_id: String(ticketId),
    payload: ticket,
  });
  return ticket;
}

export function closePickTicket(id, { picker_name, line_lots }) {
  const tid = Number(id);
  if (!Number.isInteger(tid) || tid < 1) throw new Error("invalid id");
  const picker = String(picker_name ?? "").trim();
  if (!picker) throw new Error("picker_name is required");

  const cur = db
    .prepare(
      `SELECT id, status, requester_name, request_type, manufacturing_order_id, cancelled_at
       FROM pick_tickets WHERE id = ?`,
    )
    .get(tid);
  if (!cur) return null;
  if (cur.status === "closed" || cur.cancelled_at) {
    return getPickTicket(tid);
  }

  const lotByLineId = new Map();
  if (Array.isArray(line_lots)) {
    for (const row of line_lots) {
      const lineId = Number(row?.line_id);
      if (!Number.isInteger(lineId) || lineId < 1) continue;
      lotByLineId.set(lineId, String(row?.lot_number ?? "").trim());
    }
  }

  const tx = db.transaction(() => {
    const lines = db
      .prepare(
        `SELECT l.id, l.inventory_part_id, l.requested_quantity, p.lot_number AS inventory_lot_number
         FROM pick_ticket_lines l
         JOIN inventory_parts p ON p.id = l.inventory_part_id
         WHERE l.pick_ticket_id = ?`,
      )
      .all(tid);

    const setLot = db.prepare(`UPDATE pick_ticket_lines SET lot_number = ? WHERE id = ?`);
    const adjustOnHand = db.prepare(
      `UPDATE inventory_parts SET on_hand_quantity = ?, updated_at = datetime('now') WHERE id = ?`,
    );
    const readOnHand = db.prepare(`SELECT on_hand_quantity FROM inventory_parts WHERE id = ?`);

    for (const ln of lines) {
      const lot =
        lotByLineId.get(ln.id) || String(ln.inventory_lot_number ?? "").trim() || "UNASSIGNED";
      setLot.run(lot, ln.id);

      const qty = Number(ln.requested_quantity);
      if (qty <= 0) continue;
      const inv = readOnHand.get(ln.inventory_part_id);
      if (!inv) continue;
      let next = Number(inv.on_hand_quantity);
      if (cur.request_type === "return") {
        next += qty;
      } else {
        next = Math.max(0, next - qty);
      }
      adjustOnHand.run(next, ln.inventory_part_id);
    }

    db.prepare(
      `UPDATE pick_tickets
       SET status = 'closed', closed_at = datetime('now'), closed_by = ?
       WHERE id = ?`,
    ).run(picker, tid);

    const moLabel = cur.manufacturing_order_id || "—";
    const typeLabel = String(cur.request_type ?? "issue").toUpperCase();
    const message = `Your ${typeLabel} request ${formatTicketRef(tid)} (MO ${moLabel}) was picked by ${picker}.`;
    db.prepare(
      `INSERT INTO notifications (recipient_name, pick_ticket_id, message) VALUES (?, ?, ?)`,
    ).run(cur.requester_name, tid, message);
  });

  tx();

  const ticket = getPickTicket(tid);
  appendAudit({
    actor: picker,
    action: "pick_ticket_closed",
    entity: "pick_ticket",
    entity_id: String(tid),
    payload: ticket,
  });
  return ticket;
}

export function cancelPickTicket(id, { cancelled_by }) {
  const tid = Number(id);
  if (!Number.isInteger(tid) || tid < 1) throw new Error("invalid id");
  const actor = String(cancelled_by ?? "").trim();
  if (!actor) throw new Error("cancelled_by is required");

  const cur = db
    .prepare(
      `SELECT id, status, requester_name, request_type, manufacturing_order_id, cancelled_at
       FROM pick_tickets WHERE id = ?`,
    )
    .get(tid);
  if (!cur) return null;
  if (cur.cancelled_at) return getPickTicket(tid);
  assertPickTicketActive(cur);

  db.prepare(
    `UPDATE pick_tickets
     SET cancelled_at = datetime('now'), cancelled_by = ?
     WHERE id = ?`,
  ).run(actor, tid);

  const ticket = getPickTicket(tid);
  const moLabel = cur.manufacturing_order_id || "—";
  const typeLabel = String(cur.request_type ?? "issue").toUpperCase();
  const message = `Your ${typeLabel} request ${formatTicketRef(tid)} (MO ${moLabel}) was cancelled by ${actor}.`;
  db.prepare(
    `INSERT INTO notifications (recipient_name, pick_ticket_id, message) VALUES (?, ?, ?)`,
  ).run(cur.requester_name, tid, message);

  appendAudit({
    actor,
    action: "pick_ticket_cancelled",
    entity: "pick_ticket",
    entity_id: String(tid),
    payload: ticket,
  });
  return ticket;
}

export function reopenPickTicket(id, { reopened_by }) {
  const tid = Number(id);
  if (!Number.isInteger(tid) || tid < 1) throw new Error("invalid id");
  const actor = String(reopened_by ?? "").trim();
  if (!actor) throw new Error("reopened_by is required");

  const cur = db
    .prepare(
      `SELECT id, status, request_type, requester_name, manufacturing_order_id, cancelled_at
       FROM pick_tickets WHERE id = ?`,
    )
    .get(tid);
  if (!cur) return null;
  if (cur.cancelled_at) throw new Error("cancelled tickets cannot be reopened");
  if (cur.status !== "closed") {
    return getPickTicket(tid);
  }

  const tx = db.transaction(() => {
    const lines = db
      .prepare(
        `SELECT inventory_part_id, requested_quantity
         FROM pick_ticket_lines
         WHERE pick_ticket_id = ?`,
      )
      .all(tid);

    const adjustOnHand = db.prepare(
      `UPDATE inventory_parts SET on_hand_quantity = ?, updated_at = datetime('now') WHERE id = ?`,
    );
    const readOnHand = db.prepare(`SELECT on_hand_quantity FROM inventory_parts WHERE id = ?`);

    for (const ln of lines) {
      const qty = Number(ln.requested_quantity);
      if (qty <= 0) continue;
      const inv = readOnHand.get(ln.inventory_part_id);
      if (!inv) continue;
      let next = Number(inv.on_hand_quantity);
      if (cur.request_type === "return") {
        next = Math.max(0, next - qty);
      } else {
        next += qty;
      }
      adjustOnHand.run(next, ln.inventory_part_id);
    }

    db.prepare(
      `UPDATE pick_tickets
       SET status = 'open', closed_at = NULL, closed_by = NULL
       WHERE id = ?`,
    ).run(tid);
  });

  tx();

  const ticket = getPickTicket(tid);
  appendAudit({
    actor,
    action: "pick_ticket_reopened",
    entity: "pick_ticket",
    entity_id: String(tid),
    payload: ticket,
  });
  return ticket;
}

export function listNotifications(recipientName, { unreadOnly = false } = {}) {
  const recipient = String(recipientName ?? "").trim();
  if (!recipient) throw new Error("recipient is required");
  const sql = unreadOnly
    ? `SELECT id, created_at, recipient_name, pick_ticket_id, message, read_at
       FROM notifications
       WHERE lower(trim(recipient_name)) = lower(?) AND read_at IS NULL
       ORDER BY datetime(created_at) DESC, id DESC`
    : `SELECT id, created_at, recipient_name, pick_ticket_id, message, read_at
       FROM notifications
       WHERE lower(trim(recipient_name)) = lower(?)
       ORDER BY datetime(created_at) DESC, id DESC`;
  return db.prepare(sql).all(recipient);
}

export function markNotificationsRead(recipientName, ids) {
  const recipient = String(recipientName ?? "").trim();
  if (!recipient) throw new Error("recipient is required");
  if (!Array.isArray(ids) || ids.length === 0) return { updated: 0 };
  const normalized = ids
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (normalized.length === 0) return { updated: 0 };
  const placeholders = normalized.map(() => "?").join(", ");
  const info = db
    .prepare(
      `UPDATE notifications
       SET read_at = datetime('now')
       WHERE lower(trim(recipient_name)) = lower(?)
         AND read_at IS NULL
         AND id IN (${placeholders})`,
    )
    .run(recipient, ...normalized);
  return { updated: info.changes };
}

function parseCsv(text) {
  // Minimal RFC4180-ish parser supporting quotes and commas.
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  row.push(field);
  rows.push(row);
  // Trim trailing empty last line
  while (rows.length > 0 && rows[rows.length - 1].every((c) => String(c).trim() === "")) rows.pop();
  return rows;
}

function normalizeImportHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s*-\s*/g, "_")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function parseInventoryWorkbookBuffer(buffer) {
  if (!buffer || buffer.length === 0) throw new Error("Workbook payload is empty");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Workbook must include at least one worksheet");
  const rows = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const values = [];
    for (let colNumber = 1; colNumber <= sheet.columnCount; colNumber++) {
      const value = row.getCell(colNumber).value;
      values.push(value && typeof value === "object" && "text" in value ? value.text : value);
    }
    if (values.some((v) => String(v ?? "").trim() !== "")) rows.push(values);
  }
  return rows;
}

async function parseInventoryWorkbook(base64) {
  const raw = String(base64 ?? "").trim();
  if (!raw) throw new Error("Workbook payload is empty");
  const data = raw.includes(",") ? raw.split(",").pop() : raw;
  return parseInventoryWorkbookBuffer(Buffer.from(data, "base64"));
}

function rowsToInventoryRecords(rows) {
  if (rows.length < 2) throw new Error("Import file must include a header row and at least one data row");
  const header = rows[0].map(normalizeImportHeader);
  const idx = (name) => header.indexOf(name);
  const required = [
    "part_id",
    "part_revision_id",
    "on_hand_quantity",
    "inventory_abbreviation_code",
    "default_inventory_location_id",
    "manufacturing_order_id",
    "component_part_id",
    "to_issue_quantity",
    "mo_status_code_description",
  ];
  for (const k of required) {
    if (idx(k) === -1) throw new Error(`Missing required import column: ${k}`);
  }

  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((c) => String(c ?? "").trim() === "")) continue;
    const get = (name) => {
      const i = idx(name);
      return i === -1 ? "" : String(row[i] ?? "").trim();
    };
    const part_id = get("part_id");
    const part_revision_id = get("part_revision_id");
    const item_description = get("item_description") || get("part_id_item_description") || `Item description for ${part_id}`;
    const on_hand_quantity = Number(get("on_hand_quantity"));
    const inventory_abbreviation_code = get("inventory_abbreviation_code");
    const default_inventory_location_id = get("default_inventory_location_id");
    const manufacturing_order_id = get("manufacturing_order_id");
    const component_order_id = get("component_order_id");
    const component_part_id = get("component_part_id");
    const component_part_revision_id = get("component_part_revision_id");
    const to_issue_quantity = Number(get("to_issue_quantity"));
    const mo_status_code_description = get("mo_status_code_description");

    if (
      !part_id ||
      !part_revision_id ||
      !inventory_abbreviation_code ||
      !default_inventory_location_id ||
      !manufacturing_order_id ||
      !component_part_id ||
      !mo_status_code_description
    ) {
      throw new Error(`Row ${r + 1}: missing required value(s)`);
    }
    if (!Number.isInteger(on_hand_quantity) || on_hand_quantity < 0) {
      throw new Error(`Row ${r + 1}: on_hand_quantity must be a whole number >= 0`);
    }
    if (!Number.isInteger(to_issue_quantity) || to_issue_quantity < 0) {
      throw new Error(`Row ${r + 1}: to_issue_quantity must be a whole number >= 0`);
    }

    records.push({
      part_id,
      part_revision_id,
      item_description,
      on_hand_quantity,
      inventory_abbreviation_code,
      default_inventory_location_id,
      manufacturing_order_id,
      component_order_id,
      component_part_id,
      component_part_revision_id,
      to_issue_quantity,
      mo_status_code_description,
    });
  }
  if (records.length === 0) throw new Error("Import file must include at least one data row");
  return records;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportInventoryCsv() {
  const headers = [
    "part_id",
    "part_revision_id",
    "item_description",
    "on_hand_quantity",
    "inventory_abbreviation_code",
    "default_inventory_location_id",
    "manufacturing_order_id",
    "component_order_id",
    "component_part_id",
    "component_part_revision_id",
    "to_issue_quantity",
    "mo_status_code_description",
    "updated_at",
  ];
  const rows = listParts();
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.part_id),
        csvEscape(r.part_revision_id),
        csvEscape(r.item_description),
        r.on_hand_quantity,
        csvEscape(r.inventory_abbreviation_code),
        csvEscape(r.default_inventory_location_id),
        csvEscape(r.manufacturing_order_id),
        csvEscape(r.component_order_id),
        csvEscape(r.component_part_id),
        csvEscape(r.component_part_revision_id),
        r.to_issue_quantity,
        csvEscape(r.mo_status_code_description),
        csvEscape(r.updated_at),
      ].join(","),
    );
  }
  return lines.join("\r\n");
}

function importInventoryRecords({ actor, records, sourceFormat }) {
  const a = String(actor ?? "").trim() || "unknown";
  const upsert = db.prepare(
    `INSERT INTO inventory_parts (
       part_id, part_revision_id, item_description, on_hand_quantity, inventory_abbreviation_code,
       default_inventory_location_id, manufacturing_order_id, component_order_id,
       component_part_id, component_part_revision_id, to_issue_quantity, mo_status_code_description, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(part_id, part_revision_id, manufacturing_order_id, component_order_id, component_part_id, component_part_revision_id, mo_status_code_description)
     DO UPDATE SET
       on_hand_quantity = excluded.on_hand_quantity,
       item_description = excluded.item_description,
       inventory_abbreviation_code = excluded.inventory_abbreviation_code,
       default_inventory_location_id = excluded.default_inventory_location_id,
       to_issue_quantity = excluded.to_issue_quantity,
       updated_at = datetime('now')`,
  );

  const getExisting = db.prepare(
    `SELECT id, item_description, on_hand_quantity, inventory_abbreviation_code, default_inventory_location_id, to_issue_quantity, updated_at
     FROM inventory_parts
     WHERE part_id = ? AND part_revision_id = ? AND manufacturing_order_id = ? AND component_order_id = ?
       AND component_part_id = ? AND component_part_revision_id = ? AND mo_status_code_description = ?`,
  );

  const tx = db.transaction(() => {
    let inserted = 0;
    let updated = 0;
    for (const record of records) {
      const before = getExisting.get(
        record.part_id,
        record.part_revision_id,
        record.manufacturing_order_id,
        record.component_order_id,
        record.component_part_id,
        record.component_part_revision_id,
        record.mo_status_code_description,
      );
      upsert.run(
        record.part_id,
        record.part_revision_id,
        record.item_description,
        record.on_hand_quantity,
        record.inventory_abbreviation_code,
        record.default_inventory_location_id,
        record.manufacturing_order_id,
        record.component_order_id,
        record.component_part_id,
        record.component_part_revision_id,
        record.to_issue_quantity,
        record.mo_status_code_description,
      );
      if (!before) inserted++;
      else updated++;
    }
    appendAudit({
      actor: a,
      action: "inventory_imported",
      entity: "inventory_parts",
      entity_id: null,
      payload: { inserted, updated, rows: records.length, source_format: sourceFormat },
    });
    return { inserted, updated, rows: records.length };
  });

  return tx();
}

export function importInventoryCsv({ actor, csvText }) {
  const records = rowsToInventoryRecords(parseCsv(String(csvText ?? "")));
  return importInventoryRecords({ actor, records, sourceFormat: "csv" });
}

export async function importInventoryWorkbook({ actor, workbookBase64 }) {
  const records = rowsToInventoryRecords(await parseInventoryWorkbook(workbookBase64));
  return importInventoryRecords({ actor, records, sourceFormat: "xlsx" });
}

export async function importInventoryWorkbookBuffer({ actor, workbookBuffer }) {
  const records = rowsToInventoryRecords(await parseInventoryWorkbookBuffer(workbookBuffer));
  return importInventoryRecords({ actor, records, sourceFormat: "xlsx" });
}
