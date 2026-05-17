import Database from "better-sqlite3";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
}

migrate();

const seed = db.prepare(`
  INSERT INTO inventory_parts (
    part_id,
    part_revision_id,
    on_hand_quantity,
    inventory_abbreviation_code,
    default_inventory_location_id,
    manufacturing_order_id,
    component_order_id,
    component_part_id,
    component_part_revision_id,
    to_issue_quantity,
    mo_status_code_description,
    updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
`);

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

function seedIfEmpty() {
  const n = db.prepare("SELECT COUNT(*) AS c FROM inventory_parts").get().c;
  if (n > 0) return;
  const rows = [
    {
      part_id: "test_part_001",
      part_revision_id: "test_rev_A",
      on_hand_quantity: 42,
      inventory_abbreviation_code: "test_inv_MAIN",
      default_inventory_location_id: "test_loc_A1",
      manufacturing_order_id: "test_mo_1001",
      component_order_id: "test_co_5001",
      component_part_id: "test_comp_part_01",
      component_part_revision_id: "test_comp_rev_1",
      to_issue_quantity: 5,
      mo_status_code_description: "In Shop",
    },
    {
      part_id: "test_part_002",
      part_revision_id: "test_rev_B",
      on_hand_quantity: 7,
      inventory_abbreviation_code: "test_inv_MAIN",
      default_inventory_location_id: "test_loc_B2",
      manufacturing_order_id: "test_mo_1002",
      component_order_id: "test_co_5002",
      component_part_id: "test_comp_part_02",
      component_part_revision_id: "test_comp_rev_2",
      to_issue_quantity: 12,
      mo_status_code_description: "In Shop",
    },
    {
      part_id: "test_part_003",
      part_revision_id: "test_rev_C",
      on_hand_quantity: 0,
      inventory_abbreviation_code: "test_inv_SEC",
      default_inventory_location_id: "test_loc_C3",
      manufacturing_order_id: "test_mo_1003",
      component_order_id: "test_co_5003",
      component_part_id: "test_comp_part_03",
      component_part_revision_id: "test_comp_rev_3",
      to_issue_quantity: 1,
      mo_status_code_description: "In Shop",
    },
    {
      part_id: "test_part_004",
      part_revision_id: "test_rev_D",
      on_hand_quantity: 128,
      inventory_abbreviation_code: "test_inv_MAIN",
      default_inventory_location_id: "test_loc_D4",
      manufacturing_order_id: "test_mo_1004",
      component_order_id: "test_co_5004",
      component_part_id: "test_comp_part_04",
      component_part_revision_id: "test_comp_rev_4",
      to_issue_quantity: 0,
      mo_status_code_description: "In Shop",
    },
    {
      part_id: "test_part_005",
      part_revision_id: "test_rev_E",
      on_hand_quantity: 19,
      inventory_abbreviation_code: "test_inv_QA",
      default_inventory_location_id: "test_loc_E5",
      manufacturing_order_id: "test_mo_1005",
      component_order_id: "test_co_5005",
      component_part_id: "test_comp_part_05",
      component_part_revision_id: "test_comp_rev_5",
      to_issue_quantity: 3,
      mo_status_code_description: "In Shop",
    },
  ];

  for (const r of rows) {
    seed.run(
      r.part_id,
      r.part_revision_id,
      r.on_hand_quantity,
      r.inventory_abbreviation_code,
      r.default_inventory_location_id,
      r.manufacturing_order_id,
      r.component_order_id,
      r.component_part_id,
      r.component_part_revision_id,
      r.to_issue_quantity,
      r.mo_status_code_description,
    );
  }
}

seedIfEmpty();

export function listParts() {
  return db
    .prepare(
      `SELECT
         id,
         part_id,
         part_revision_id,
         on_hand_quantity,
         inventory_abbreviation_code,
         default_inventory_location_id,
         manufacturing_order_id,
         component_order_id,
         component_part_id,
         component_part_revision_id,
         to_issue_quantity,
         mo_status_code_description,
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
    db.exec("DELETE FROM inventory_parts;");
    seedIfEmpty();
    const after = db.prepare("SELECT COUNT(*) AS c FROM inventory_parts").get().c;
    appendAudit({
      actor: a,
      action: "inventory_reset",
      entity: "inventory_parts",
      entity_id: null,
      payload: { before_count: before, after_count: after },
    });
    return { before_count: before, after_count: after };
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

export function listPickTickets() {
  return db
    .prepare(
      `SELECT
         t.id,
         t.created_at,
         t.requester_name,
         t.status,
         (SELECT COUNT(*) FROM pick_ticket_lines l WHERE l.pick_ticket_id = t.id) AS line_count
       FROM pick_tickets t
       ORDER BY datetime(t.created_at) DESC, t.id DESC`,
    )
    .all();
}

export function getPickTicket(id) {
  const ticket = db
    .prepare(`SELECT id, created_at, requester_name, status, closed_at, closed_by FROM pick_tickets WHERE id = ?`)
    .get(id);
  if (!ticket) return null;
  const lines = db
    .prepare(
      `SELECT
         l.id,
         l.inventory_part_id,
         l.requested_quantity,
         p.part_id,
         p.part_revision_id,
         p.on_hand_quantity,
         p.inventory_abbreviation_code,
         p.default_inventory_location_id,
         p.manufacturing_order_id,
         p.component_order_id,
         p.component_part_id,
         p.component_part_revision_id,
         p.to_issue_quantity,
         p.mo_status_code_description
       FROM pick_ticket_lines l
       JOIN inventory_parts p ON p.id = l.inventory_part_id
       WHERE l.pick_ticket_id = ?
       ORDER BY l.id ASC`,
    )
    .all(id);
  return { ...ticket, lines };
}

export function createPickTicket({ requester_name, lines }) {
  const requester = String(requester_name ?? "").trim();
  if (!requester) throw new Error("requester_name is required");
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("lines are required");

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

  const tx = db.transaction(() => {
    const info = db
      .prepare(`INSERT INTO pick_tickets (requester_name) VALUES (?)`)
      .run(requester);
    const ticketId = info.lastInsertRowid;
    const insLine = db.prepare(
      `INSERT INTO pick_ticket_lines (pick_ticket_id, inventory_part_id, requested_quantity)
       VALUES (?,?,?)`,
    );
    for (const ln of normalized) {
      // Ensure inventory part exists
      const inv = db.prepare(`SELECT id FROM inventory_parts WHERE id = ?`).get(ln.inventory_part_id);
      if (!inv) throw new Error(`inventory_part_id not found: ${ln.inventory_part_id}`);
      insLine.run(ticketId, ln.inventory_part_id, ln.requested_quantity);
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

export function closePickTicket(id, { picker_name }) {
  const tid = Number(id);
  if (!Number.isInteger(tid) || tid < 1) throw new Error("invalid id");
  const picker = String(picker_name ?? "").trim();
  if (!picker) throw new Error("picker_name is required");

  const cur = db
    .prepare(`SELECT id, status FROM pick_tickets WHERE id = ?`)
    .get(tid);
  if (!cur) return null;
  if (cur.status === "closed") {
    return getPickTicket(tid);
  }

  db.prepare(
    `UPDATE pick_tickets
     SET status = 'closed', closed_at = datetime('now'), closed_by = ?
     WHERE id = ?`,
  ).run(picker, tid);

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

export function importInventoryCsv({ actor, csvText }) {
  const a = String(actor ?? "").trim() || "unknown";
  const text = String(csvText ?? "");
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV must include a header row and at least one data row");
  const header = rows[0].map((h) => String(h).trim());
  const idx = (name) => header.indexOf(name);
  const required = [
    "part_id",
    "part_revision_id",
    "on_hand_quantity",
    "inventory_abbreviation_code",
    "default_inventory_location_id",
    "manufacturing_order_id",
    "component_order_id",
    "component_part_id",
    "component_part_revision_id",
    "to_issue_quantity",
    "mo_status_code_description",
  ];
  for (const k of required) {
    if (idx(k) === -1) throw new Error(`Missing required CSV column: ${k}`);
  }

  const upsert = db.prepare(
    `INSERT INTO inventory_parts (
       part_id, part_revision_id, on_hand_quantity, inventory_abbreviation_code,
       default_inventory_location_id, manufacturing_order_id, component_order_id,
       component_part_id, component_part_revision_id, to_issue_quantity, mo_status_code_description, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(part_id, part_revision_id, manufacturing_order_id, component_order_id, component_part_id, component_part_revision_id, mo_status_code_description)
     DO UPDATE SET
       on_hand_quantity = excluded.on_hand_quantity,
       inventory_abbreviation_code = excluded.inventory_abbreviation_code,
       default_inventory_location_id = excluded.default_inventory_location_id,
       to_issue_quantity = excluded.to_issue_quantity,
       updated_at = datetime('now')`,
  );

  const getExisting = db.prepare(
    `SELECT id, on_hand_quantity, inventory_abbreviation_code, default_inventory_location_id, to_issue_quantity, updated_at
     FROM inventory_parts
     WHERE part_id = ? AND part_revision_id = ? AND manufacturing_order_id = ? AND component_order_id = ?
       AND component_part_id = ? AND component_part_revision_id = ? AND mo_status_code_description = ?`,
  );

  const tx = db.transaction(() => {
    let inserted = 0;
    let updated = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const part_id = String(row[idx("part_id")] ?? "").trim();
      const part_revision_id = String(row[idx("part_revision_id")] ?? "").trim();
      const on_hand_quantity = Number(String(row[idx("on_hand_quantity")] ?? "").trim());
      const inventory_abbreviation_code = String(row[idx("inventory_abbreviation_code")] ?? "").trim();
      const default_inventory_location_id = String(row[idx("default_inventory_location_id")] ?? "").trim();
      const manufacturing_order_id = String(row[idx("manufacturing_order_id")] ?? "").trim();
      const component_order_id = String(row[idx("component_order_id")] ?? "").trim();
      const component_part_id = String(row[idx("component_part_id")] ?? "").trim();
      const component_part_revision_id = String(row[idx("component_part_revision_id")] ?? "").trim();
      const to_issue_quantity = Number(String(row[idx("to_issue_quantity")] ?? "").trim());
      const mo_status_code_description = String(row[idx("mo_status_code_description")] ?? "").trim();

      if (
        !part_id ||
        !part_revision_id ||
        !inventory_abbreviation_code ||
        !default_inventory_location_id ||
        !manufacturing_order_id ||
        !component_order_id ||
        !component_part_id ||
        !component_part_revision_id ||
        !mo_status_code_description
      ) {
        throw new Error(`Row ${r + 1}: missing required value(s)`);
      }
      if (!Number.isInteger(on_hand_quantity) || on_hand_quantity < 0) {
        throw new Error(`Row ${r + 1}: on_hand_quantity must be a whole number ≥ 0`);
      }
      if (!Number.isInteger(to_issue_quantity) || to_issue_quantity < 0) {
        throw new Error(`Row ${r + 1}: to_issue_quantity must be a whole number ≥ 0`);
      }

      const before = getExisting.get(
        part_id,
        part_revision_id,
        manufacturing_order_id,
        component_order_id,
        component_part_id,
        component_part_revision_id,
        mo_status_code_description,
      );
      upsert.run(
        part_id,
        part_revision_id,
        on_hand_quantity,
        inventory_abbreviation_code,
        default_inventory_location_id,
        manufacturing_order_id,
        component_order_id,
        component_part_id,
        component_part_revision_id,
        to_issue_quantity,
        mo_status_code_description,
      );
      const after = getExisting.get(
        part_id,
        part_revision_id,
        manufacturing_order_id,
        component_order_id,
        component_part_id,
        component_part_revision_id,
        mo_status_code_description,
      );

      if (!before) inserted++;
      else updated++;

      appendAudit({
        actor: a,
        action: before ? "inventory_row_updated" : "inventory_row_inserted",
        entity: "inventory_part",
        entity_id: String(after?.id ?? ""),
        payload: { identity: { part_id, part_revision_id, manufacturing_order_id, component_order_id, component_part_id, component_part_revision_id, mo_status_code_description }, before, after },
      });
    }
    appendAudit({
      actor: a,
      action: "inventory_csv_imported",
      entity: "inventory_parts",
      entity_id: null,
      payload: { inserted, updated, rows: rows.length - 1 },
    });
    return { inserted, updated, rows: rows.length - 1 };
  });

  return tx();
}
