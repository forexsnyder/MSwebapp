import Database from "better-sqlite3";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import JSZip from "jszip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultDataDir = join(__dirname, "data");
const envDbPath = process.env.DB_PATH ? String(process.env.DB_PATH) : "";
const dbPath = envDbPath.trim() || join(defaultDataDir, "app.db");
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");

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
    part_id_item_description TEXT NOT NULL DEFAULT '',
    on_hand_quantity REAL NOT NULL CHECK (on_hand_quantity >= 0),
    inventory_abbreviation_code TEXT NOT NULL,
    default_inventory_location_id TEXT NOT NULL,
    manufacturing_order_id TEXT NOT NULL,
    component_order_id TEXT NOT NULL,
    component_part_id TEXT NOT NULL,
    component_part_revision_id TEXT NOT NULL,
    component_part_id_item_description TEXT NOT NULL DEFAULT '',
    to_issue_quantity REAL NOT NULL CHECK (to_issue_quantity >= 0),
    mo_status_code_description TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
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

  CREATE TABLE IF NOT EXISTS manufacturing_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manufacturing_order_id TEXT NOT NULL DEFAULT '',
    component_order_id TEXT NOT NULL DEFAULT '',
    component_part_id TEXT NOT NULL DEFAULT '',
    component_part_revision_id TEXT NOT NULL DEFAULT '',
    part_id TEXT NOT NULL DEFAULT '',
    part_revision_id TEXT NOT NULL DEFAULT '',
    item_description TEXT NOT NULL DEFAULT '',
    component_part_id_item_description TEXT NOT NULL DEFAULT '',
    to_issue_quantity REAL NOT NULL DEFAULT 0 CHECK (to_issue_quantity >= 0),
    mo_status_code_description TEXT NOT NULL DEFAULT '',
    source_row_hash TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS ux_manufacturing_orders_source_row_hash
    ON manufacturing_orders (source_row_hash);

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
  db.exec(`
    CREATE TABLE IF NOT EXISTS manufacturing_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manufacturing_order_id TEXT NOT NULL DEFAULT '',
      component_order_id TEXT NOT NULL DEFAULT '',
      component_part_id TEXT NOT NULL DEFAULT '',
      component_part_revision_id TEXT NOT NULL DEFAULT '',
      part_id TEXT NOT NULL DEFAULT '',
      part_revision_id TEXT NOT NULL DEFAULT '',
      item_description TEXT NOT NULL DEFAULT '',
      component_part_id_item_description TEXT NOT NULL DEFAULT '',
      to_issue_quantity REAL NOT NULL DEFAULT 0 CHECK (to_issue_quantity >= 0),
      mo_status_code_description TEXT NOT NULL DEFAULT '',
      source_row_hash TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_manufacturing_orders_source_row_hash
      ON manufacturing_orders (source_row_hash);
  `);

  const moCols = tableColumns("manufacturing_orders");
  if (moCols.length > 0 && !moCols.includes("component_part_id_item_description")) {
    db.exec(
      `ALTER TABLE manufacturing_orders
       ADD COLUMN component_part_id_item_description TEXT NOT NULL DEFAULT ''`,
    );
    db.exec(
      `UPDATE manufacturing_orders
       SET component_part_id_item_description =
         CASE
           WHEN trim(component_part_id) <> '' AND trim(item_description) <> ''
             THEN component_part_id || ' - ' || item_description
           ELSE trim(component_part_id || ' ' || item_description)
         END
       WHERE trim(component_part_id_item_description) = ''`,
    );
  }
  if (invCols.length > 0 && !invCols.includes("part_id_item_description")) {
    db.exec(`ALTER TABLE inventory_parts ADD COLUMN part_id_item_description TEXT NOT NULL DEFAULT ''`);
    db.exec(
      `UPDATE inventory_parts
       SET part_id_item_description =
         CASE
           WHEN trim(part_id) <> '' AND trim(item_description) <> ''
             THEN part_id || ' - ' || item_description
           ELSE trim(part_id || ' ' || item_description)
         END
       WHERE trim(part_id_item_description) = ''`,
    );
  }
  if (invCols.length > 0 && !invCols.includes("is_active")) {
    db.exec(`ALTER TABLE inventory_parts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
  }

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
  if (invCols.length > 0 && !invCols.includes("component_part_id_item_description")) {
    db.exec(
      `ALTER TABLE inventory_parts
       ADD COLUMN component_part_id_item_description TEXT NOT NULL DEFAULT ''`,
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
         part_id_item_description,
         on_hand_quantity,
         inventory_abbreviation_code,
         default_inventory_location_id,
         manufacturing_order_id,
         component_order_id,
         component_part_id,
         component_part_revision_id,
         component_part_id_item_description,
         to_issue_quantity,
         mo_status_code_description,
         lot_number,
         updated_at
       FROM inventory_parts
       WHERE
         is_active = 1
         AND (
         trim(manufacturing_order_id) <> ''
         OR NOT EXISTS (
           SELECT 1 FROM inventory_parts mo_rows
           WHERE mo_rows.is_active = 1 AND trim(mo_rows.manufacturing_order_id) <> ''
         )
         )
       ORDER BY manufacturing_order_id, component_part_id, part_id, part_revision_id`,
    )
    .all();
}

export function resetInventory({ actor } = {}) {
  const a = String(actor ?? "").trim() || "unknown";
  const tx = db.transaction(() => {
    const before = db.prepare("SELECT COUNT(*) AS c FROM inventory_parts WHERE is_active = 1").get().c;
    const pickTicketsBefore = db.prepare("SELECT COUNT(*) AS c FROM pick_tickets").get().c;
    const pickTicketLinesBefore = db.prepare("SELECT COUNT(*) AS c FROM pick_ticket_lines").get().c;
    // Preserve ticket-linked rows outside the active catalog. A later import of
    // the same inventory identity reactivates them without breaking the queue.
    db.exec("UPDATE inventory_parts SET is_active = 0;");
    const after = db.prepare("SELECT COUNT(*) AS c FROM inventory_parts WHERE is_active = 1").get().c;
    appendAudit({
      actor: a,
      action: "inventory_reset",
      entity: "inventory_parts",
      entity_id: null,
      payload: {
        before_count: before,
        after_count: after,
        pick_tickets_preserved: pickTicketsBefore,
        pick_ticket_lines_preserved: pickTicketLinesBefore,
      },
    });
    return {
      before_count: before,
      after_count: after,
      pick_tickets_preserved: pickTicketsBefore,
      pick_ticket_lines_preserved: pickTicketLinesBefore,
    };
  });
  return tx();
}

export function resetManufacturingOrders({ actor } = {}) {
  const a = String(actor ?? "").trim() || "unknown";
  const tx = db.transaction(() => {
    const before = db.prepare("SELECT COUNT(*) AS c FROM manufacturing_orders").get().c;
    db.exec("DELETE FROM manufacturing_orders;");
    const after = db.prepare("SELECT COUNT(*) AS c FROM manufacturing_orders").get().c;
    appendAudit({
      actor: a,
      action: "manufacturing_orde�n�����k�w��@�����}��}�ѕ�}��͍ɥ�ѥ���(�����(��������Ё��!���%�����􁥑ࠉ��}����}�Յ�ѥ�䈤�(��������Ё��}����}�Յ�ѥ���(��������!���%��������Ā��������͕%�����EՅ�ѥ��ɽ�m��!���%����t��Ȁ��İ����}����}�Յ�ѥ�䈤�(��������Ё��ٕ�ѽ��}���ɕ٥�ѥ��}�����􁝕Р���ٕ�ѽ��}���ɕ٥�ѥ��}�������(��������Ё����ձ�}��ٕ�ѽ��}����ѥ��}���􁝕Р�����ձ�}��ٕ�ѽ��}����ѥ��}�����(��������Ё���ՙ����ɥ��}�ɑ��}���􁝕Р����ՙ����ɥ��}�ɑ��}�����(��������Ё���������}�ɑ��}���􁝕Р����������}�ɑ��}�����(��������Ё���������}����}���􁝕Р����������}����}�����(��������Ё���������}����}ɕ٥ͥ��}���􁝕Р����������}����}ɕ٥ͥ��}�����(��������Ёѽ}���Օ}�Յ�ѥ���(��������ࠉѽ}���Օ}�Յ�ѥ�䈤����Ā��������͕%�����EՅ�ѥ��ɽ�m��ࠉѽ}���Օ}�Յ�ѥ�䈥t��Ȁ��İ��ѽ}���Օ}�Յ�ѥ�䈤�(��������Ё��}�х���}����}��͍ɥ�ѥ���􁝕Р���}�х���}����}��͍ɥ�ѥ�����((�������������}����������������}����}����������ՙ����ɥ��}�ɑ��}�������ѥ�Ք�((����ɕ��ɑ̹��͠��(����������}���(����������}ɕ٥ͥ��}���(�������ѕ�}��͍ɥ�ѥ���(����������}��}�ѕ�}��͍ɥ�ѥ���(������������}��}�ѕ�}��͍ɥ�ѥ�����(�������������}�������ѕ�}��͍ɥ�ѥ������������}��􀴀���ѕ�}��͍ɥ�ѥ����������}�������ѕ�}��͍ɥ�ѥ����(��������}����}�Յ�ѥ��(��������ٕ�ѽ��}���ɕ٥�ѥ��}�����4(����������ձ�}��ٕ�ѽ��}����ѥ��}���4(���������ՙ����ɥ��}�ɑ��}���4(���������������}�ɑ��}���4(���������������}����}���4(���������������}����}ɕ٥ͥ��}���4(������ѽ}���Օ}�Յ�ѥ��4(��������}�х���}����}��͍ɥ�ѥ���4(�������(���(��ɕ��ɸ�ɕ��ɑ��)�()�չ�ѥ���ɽ��Q�5��ՙ����ɥ��=ɑ��I���ɑ̡ɽ�̤��(������ɽ�̹����Ѡ���Ĥ�ѡɽ܁��܁�ɽȠ�%����Ё��������Ё����Ց���������ȁɽ܈��(������Ё�����Ȁ�ɽ��l�t�������ɵ����%�����!����Ȥ�(������Ё����􀡹�������������ȹ�����=��������((������Ёɕ��ɑ̀�mt�(����Ȁ���ЁȀ���Ȁ��ɽ�̹����Ѡ�Ȭ����(��������Ёɽ܀�ɽ��m�t�4(��������ɽܹ�ٕ�䠡����������Y��ՕQ�%�����Q��С����ɥ������􀈈������ѥ�Ք�4(��������Ё��Ѐ􀡹���������4(����������Ё��􁥑ࡹ�����4(������ɕ��ɸ������Ā�����聍���Y��ՕQ�%�����Q��Сɽ�m�t���ɥ����4(������4(��������ЁɅ܀����4(���������ȹ������������������ऀ����4(�����������������ɕ��ɸ�4(������Ʌ�m����t�􁍕��Y��ՕQ�%�����Q��Сɽ�m�����t���ɥ����4(�������4(��������Ё���ՙ����ɥ��}�ɑ��}���􁝕Р����ՙ����ɥ��}�ɑ��}�����4(��������Ё���������}�ɑ��}���􁝕Р����������}�ɑ��}�����4(��������Ё���������}����}���􁝕Р����������}����}�����4(��������Ё���������}����}ɕ٥ͥ��}���􁝕Р����������}����}ɕ٥ͥ��}�����(��������Ё����}���􁝕Р�����}�����(��������Ё����}ɕ٥ͥ��}���􁝕Р�����}ɕ٥ͥ��}�����(��������Ё�ѕ�}��͍ɥ�ѥ���􁝕Р��ѕ�}��͍ɥ�ѥ�����(��������Ё���������}����}��}�ѕ�}��͍ɥ�ѥ����(��������Р����������}����}��}�ѕ�}��͍ɥ�ѥ�������(����������������}����}�������ѕ�}��͍ɥ�ѥ�������퍽�������}����}��􀴀���ѕ�}��͍ɥ�ѥ�����耈���(��������Ёѽ}���Օ}�Յ�ѥ���(��������ࠉѽ}���Օ}�Յ�ѥ�䈤����Ā��������͕%�����EՅ�ѥ��ɽ�m��ࠉѽ}���Օ}�Յ�ѥ�䈥t��Ȁ��İ��ѽ}���Օ}�Յ�ѥ�䈤�(��������Ё��}�х���}����}��͍ɥ�ѥ���􁝕Р���}�х���}����}��͍ɥ�ѥ�����((������������ՙ����ɥ��}�ɑ��}����������������}����}�������ѥ�Ք�((��������Ёͽ�ɍ�}ɽ�}��͠��͡����!�ࡍ��������)ͽ��Ʌܤ��(4(����ɕ��ɑ̹��͠��4(���������ՙ����ɥ��}�ɑ��}���4(���������������}�ɑ��}���4(���������������}����}���4(���������������}����}ɕ٥ͥ��}���4(����������}���(����������}ɕ٥ͥ��}���(�������ѕ�}��͍ɥ�ѥ���(���������������}����}��}�ѕ�}��͍ɥ�ѥ���(������ѽ}���Օ}�Յ�ѥ��(��������}�х���}����}��͍ɥ�ѥ���(������ͽ�ɍ�}ɽ�}��͠�(������Ʌ�}�ͽ�聍��������)ͽ��Ʌܤ�4(�������(���(��ɕ��ɸ�ɕ��ɑ��)�(4)�չ�ѥ������͍����م�Ք���(������م�Ք����ձ�����م�Ք����չ���������ɕ��ɸ����4(������Ё̀�M�ɥ���م�Ք��4(�������l��q�q�t��ѕ�С̤��ɕ��ɸ�����̹ɕ�������������������4(��ɕ��ɸ���)�()�չ�ѥ����幍5�I���Q�%�ٕ�ѽ��A���̠���(������Ё����ɔ�􁑈��ɕ��ɔ��M1
P�
=U9P����L���I=4���ٕ�ѽ��}����́]!I���}��ѥٔ��ā9��ɥ�����ՙ����ɥ��}�ɑ��}��������������Р����(������ᕌ��(����%9MIP�%9Q<���ٕ�ѽ��}����̀�(����������}���(����������}ɕ٥ͥ��}���(�������ѕ�}��͍ɥ�ѥ���(����������}��}�ѕ�}��͍ɥ�ѥ���(��������}����}�Յ�ѥ��(��������ٕ�ѽ��}���ɕ٥�ѥ��}�����(����������ձ�}��ٕ�ѽ��}����ѥ��}���(���������ՙ����ɥ��}�ɑ��}���(���������������}�ɑ��}���(���������������}����}���(���������������}����}ɕ٥ͥ��}���(���������������}����}��}�ѕ�}��͍ɥ�ѥ���(������ѽ}���Օ}�Յ�ѥ��(��������}�х���}����}��͍ɥ�ѥ���(��������}��ѥٔ�(����������ѕ�}��(�����(����M1
P(��������ع����}���(��������ع����}ɕ٥ͥ��}���(������
=1M
�9U11%��ɥ����ع�ѕ�}��͍ɥ�ѥ��������������ѕ�}��͍ɥ�ѥ����(��������ع����}��}�ѕ�}��͍ɥ�ѥ���(��������ع��}����}�Յ�ѥ��(��������ع��ٕ�ѽ��}���ɕ٥�ѥ��}�����(��������ع����ձ�}��ٕ�ѽ��}����ѥ��}���(������������ՙ����ɥ��}�ɑ��}���(������������������}�ɑ��}���(������������������}����}���(������
=1M
�9U11%��ɥ��������������}����}ɕ٥ͥ��}������������ع����}ɕ٥ͥ��}����(������
=1M
�(��������9U11%��ɥ��������������}����}��}�ѕ�}��͍ɥ�ѥ���������(��������
M(����������]!8��ɥ��������������}����}����������9��ɥ������ѕ�}��͍ɥ�ѥ���������(������������Q!8�������������}����}�������������������ѕ�}��͍ɥ�ѥ��(����������1M��ɥ��������������}����}�����������������ѕ�}��͍ɥ�ѥ���(��������9(��������(���������ѽ}���Օ}�Յ�ѥ��(�����������}�х���}����}��͍ɥ�ѥ���(������İ(��������ѕѥ������ܜ�(����I=4����ՙ����ɥ��}�ɑ��́��(����)=%8���ٕ�ѽ��}����́���(������=8��ɥ����ع���ՙ����ɥ��}�ɑ��}����􀜜(�����9��ɥ����ع���������}����}����􀜜(�����9���ع��}��ѥٔ���(�����9���ع����}���􁵼����������}����}��(����]!I��ɥ��������ՙ����ɥ��}�ɑ��}���������(������9��ɥ��������������}����}���������(����=8�
=91%
P�(����������}���(����������}ɕ٥ͥ��}���(���������ՙ����ɥ��}�ɑ��}���(���������������}�ɑ��}���(���������������}����}���(���������������}����}ɕ٥ͥ��}���(��������}�х���}����}��͍ɥ�ѥ��(�����(����<�UAQ�MP(�������ѕ�}��͍ɥ�ѥ����፱Ց����ѕ�}��͍ɥ�ѥ���(���������������}����}��}�ѕ�}��͍ɥ�ѥ����፱Ց������������}����}��}�ѕ�}��͍ɥ�ѥ���(��������}����}�Յ�ѥ���፱Ց�����}����}�Յ�ѥ��(��������ٕ�ѽ��}���ɕ٥�ѥ��}������፱Ց�����ٕ�ѽ��}���ɕ٥�ѥ��}�����(����������ձ�}��ٕ�ѽ��}����ѥ��}����፱Ց�������ձ�}��ٕ�ѽ��}����ѥ��}���(������ѽ}���Օ}�Յ�ѥ���፱Ց���ѽ}���Օ}�Յ�ѥ��(��������}��ѥٔ��İ(����������ѕ�}�Ѐ􁑅ѕѥ������ܜ�(�����(������Ё��ѕȀ􁑈��ɕ��ɔ��M1
P�
=U9P����L���I=4���ٕ�ѽ��}����́]!I���}��ѥٔ��ā9��ɥ�����ՙ����ɥ��}�ɑ��}��������������Р����(��ɕ��ɸ�쁉���ɔ����ѕȰ��幍��聅�ѕȁ��)�()�����Ё�չ�ѥ���������%�ٕ�ѽ��
�ؠ���(������Ё������̀�l4(���������}����(���������}ɕ٥ͥ��}����(������ѕ�}��͍ɥ�ѥ����(���������}��}�ѕ�}��͍ɥ�ѥ����(�������}����}�Յ�ѥ�䈰4(�������ٕ�ѽ��}���ɕ٥�ѥ��}������4(���������ձ�}��ٕ�ѽ��}����ѥ��}����4(��������ՙ����ɥ��}�ɑ��}����4(��������������}�ɑ��}����4(��������������}����}����4(��������������}����}ɕ٥ͥ��}����4(�����ѽ}���Օ}�Յ�ѥ�䈰4(�������}�х���}����}��͍ɥ�ѥ����4(���������ѕ�}�Ј�4(��t�4(������Ёɽ�̀􁱥��A���̠��4(������Ё����̀�m������̹���������t�4(����Ȁ�����Ёȁ���ɽ�̤��4(��������̹��͠�4(������l4(�����������͍����ȹ����}����(�����������͍����ȹ����}ɕ٥ͥ��}����(�����������͍����ȹ�ѕ�}��͍ɥ�ѥ����(�����������͍����ȹ����}��}�ѕ�}��͍ɥ�ѥ����(��������ȹ��}����}�Յ�ѥ��4(�����������͍����ȹ��ٕ�ѽ��}���ɕ٥�ѥ��}������4(�����������͍����ȹ����ձ�}��ٕ�ѽ��}����ѥ��}����4(�����������͍����ȹ���ՙ����ɥ��}�ɑ��}����4(�����������͍����ȹ���������}�ɑ��}����4(�����������͍����ȹ���������}����}����4(�����������͍����ȹ���������}����}ɕ٥ͥ��}����4(��������ȹѽ}���Օ}�Յ�ѥ��4(�����������͍����ȹ��}�х���}����}��͍ɥ�ѥ����4(�����������͍����ȹ����ѕ�}�Ф�4(������t�����������4(������4(���4(��ɕ��ɸ�����̹������q�q����4)�4(4)�չ�ѥ���������%�ٕ�ѽ��I���ɑ̡쁅�ѽȰ�ɕ��ɑ̰�ͽ�ɍ��ɵ�Ё����4(������Ё���M�ɥ�����ѽȀ��������ɥ��������չ���ݸ��4(������Ё��ٕ�ѽ��%���ѥ��-���ɽܤ���4(����l4(������ɽܹ����}���4(������ɽܹ����}ɕ٥ͥ��}���4(������ɽܹ���ՙ����ɥ��}�ɑ��}���4(������ɽܹ���������}�ɑ��}���4(������ɽܹ���������}����}���4(������ɽܹ���������}����}ɕ٥ͥ��}���4(������ɽܹ��}�х���}����}��͍ɥ�ѥ���4(����t�������q�Ř���4(������Ё��͕�Ѐ􁑈��ɕ��ɔ�4(�����%9MIP�%9Q<���ٕ�ѽ��}����̀�(�����������}��������}ɕ٥ͥ��}�����ѕ�}��͍ɥ�ѥ��������}��}�ѕ�}��͍ɥ�ѥ������}����}�Յ�ѥ�䰁��ٕ�ѽ��}���ɕ٥�ѥ��}�����(�����������ձ�}��ٕ�ѽ��}����ѥ��}�������ՙ����ɥ��}�ɑ��}�������������}�ɑ��}���(����������������}����}�������������}����}ɕ٥ͥ��}����ѽ}���Օ}�Յ�ѥ�䰁��}�х���}����}��͍ɥ�ѥ������}��ѥٔ������ѕ�}��(�������Y1UL��������������������������������ѕѥ������ܜ��(�����=8�
=91%
P�����}��������}ɕ٥ͥ��}�������ՙ����ɥ��}�ɑ��}�������������}�ɑ��}�������������}����}�������������}����}ɕ٥ͥ��}������}�х���}����}��͍ɥ�ѥ���4(�����<�UAQ�MP4(���������}����}�Յ�ѥ���፱Ց�����}����}�Յ�ѥ��(��������ѕ�}��͍ɥ�ѥ����፱Ց����ѕ�}��͍ɥ�ѥ���(�����������}��}�ѕ�}��͍ɥ�ѥ����፱Ց�������}��}�ѕ�}��͍ɥ�ѥ���(���������ٕ�ѽ��}���ɕ٥�ѥ��}������፱Ց�����ٕ�ѽ��}���ɕ٥�ѥ��}�����(�����������ձ�}��ٕ�ѽ��}����ѥ��}����፱Ց�������ձ�}��ٕ�ѽ��}����ѥ��}���(�������ѽ}���Օ}�Յ�ѥ���፱Ց���ѽ}���Օ}�Յ�ѥ��(���������}��ѥٔ��İ(�����������ѕ�}�Ѐ􁑅ѕѥ������ܜ���4(����4(4(������Ё���􁑈��Ʌ�ͅ�ѥ����������4(������Ё��͕�ѕ�����4(������Ё����ѕ�����4(��������Ё���ѥ��-��̀􁹕܁M�Р4(��������4(����������ɕ��ɔ�4(�����������M1
P4(�����������������}���4(�����������������}ɕ٥ͥ��}���4(����������������ՙ����ɥ��}�ɑ��}���4(����������������������}�ɑ��}���4(����������������������}����}���4(����������������������}����}ɕ٥ͥ��}���4(���������������}�х���}����}��͍ɥ�ѥ��4(�����������I=4���ٕ�ѽ��}����̀�4(���������4(��������������4(���������������ٕ�ѽ��%���ѥ��-�䤰4(������4(������Ȁ�����Ёɕ��ɐ����ɕ��ɑ̤��4(����������Ё���􁥹ٕ�ѽ��%���ѥ��-��ɕ��ɐ��4(��������͕�й�ո�4(��������ɕ��ɐ�����}���4(��������ɕ��ɐ�����}ɕ٥ͥ��}���(��������ɕ��ɐ��ѕ�}��͍ɥ�ѥ���(��������ɕ��ɐ�����}��}�ѕ�}��͍ɥ�ѥ���(��������ɕ��ɐ���}����}�Յ�ѥ��(��������ɕ��ɐ���ٕ�ѽ��}���ɕ٥�ѥ��}�����4(��������ɕ��ɐ�����ձ�}��ٕ�ѽ��}����ѥ��}���4(��������ɕ��ɐ����ՙ����ɥ��}�ɑ��}���4(��������ɕ��ɐ����������}�ɑ��}���4(��������ɕ��ɐ����������}����}���4(��������ɕ��ɐ����������}����}ɕ٥ͥ��}���(��������ɕ��ɐ�ѽ}���Օ}�Յ�ѥ��(��������ɕ��ɐ���}�х���}����}��͍ɥ�ѥ���(��������İ(��������(�������������ѥ��-��̹��̡��䤤��4(������������ѕ����4(������􁕱͔��4(����������͕�ѕ����4(�����������ѥ��-��̹��������4(�������4(�����4(����������Ց�С�4(��������ѽ�聄�4(��������ѥ��耉��ٕ�ѽ��}�����ѕ���4(��������ѥ��耉��ٕ�ѽ��}����̈�4(��������ѥ��}��聹ձ��4(��������屽���쁥�͕�ѕ�������ѕ���ɽ���ɕ��ɑ̹����Ѡ��ͽ�ɍ�}��ɵ���ͽ�ɍ��ɵ�Ё��4(�������(��������Ё�幌���幍5�I���Q�%�ٕ�ѽ��A���̠��(����ɕ��ɸ�쁥�͕�ѕ�������ѕ���ɽ���ɕ��ɑ̹����Ѡ���幍��}ɕ�Օ��}ɽ����幌��幍�����(�����(4(��ɕ��ɸ��ࠤ�4)�4(4)�����Ё�չ�ѥ���������%�ٕ�ѽ��
�ء쁅�ѽȰ����Q��Ё����4(������Ёɕ��ɑ̀�ɽ��Q�%�ٕ�ѽ��I���ɑ̡���͕
�ءM�ɥ������Q��Ѐ���������4(��ɕ��ɸ�������%�ٕ�ѽ��I���ɑ̡쁅�ѽȰ�ɕ��ɑ̰�ͽ�ɍ��ɵ��耉��؈����4)�4(4)�����Ё��幌��չ�ѥ���������%�ٕ�ѽ��]�ɭ�����쁅�ѽȰ�ݽɭ����	�͔�Ё����4(������Ёɕ��ɑ̀�ɽ��Q�%�ٕ�ѽ��I���ɑ̡�݅�Ё���͕%�ٕ�ѽ��]�ɭ�����ݽɭ����	�͔�Ф��4(��ɕ��ɸ�������%�ٕ�ѽ��I���ɑ̡쁅�ѽȰ�ɕ��ɑ̰�ͽ�ɍ��ɵ��耉��������4)�4(4)�����Ё��幌��չ�ѥ���������%�ٕ�ѽ��]�ɭ����	ՙ��ȡ쁅�ѽȰ�ݽɭ����	ՙ��ȁ����4(������Ёɕ��ɑ̀�ɽ��Q�%�ٕ�ѽ��I���ɑ̡�݅�Ё���͕%�ٕ�ѽ��]�ɭ����	ՙ��ȡݽɭ����	ՙ��Ȥ��4(��ɕ��ɸ�������%�ٕ�ѽ��I���ɑ̡쁅�ѽȰ�ɕ��ɑ̰�ͽ�ɍ��ɵ��耉��������4)�4(4)�չ�ѥ���������5��ՙ����ɥ��=ɑ��I���ɑ̡쁅�ѽȰ�ɕ��ɑ̰�ͽ�ɍ��ɵ�Ё����4(������Ё���M�ɥ�����ѽȀ��������ɥ��������չ���ݸ��4(������Ё��͕�Ѐ􁑈��ɕ��ɔ�(�����%9MIP�%9Q<����ՙ����ɥ��}�ɑ��̀�(����������ՙ����ɥ��}�ɑ��}�������������}�ɑ��}�������������}����}�������������}����}ɕ٥ͥ��}���(�����������}��������}ɕ٥ͥ��}�����ѕ�}��͍ɥ�ѥ�������������}����}��}�ѕ�}��͍ɥ�ѥ���(�������ѽ}���Օ}�Յ�ѥ�䰁��}�х���}����}��͍ɥ�ѥ����ͽ�ɍ�}ɽ�}��͠��Ʌ�}�ͽ�������ѕ�}��(�������Y1UL����������������������������ѕѥ������ܜ��(�����=8�
=91%
P�ͽ�ɍ�}ɽ�}��͠�(�����<�UAQ�MP(����������ՙ����ɥ��}�ɑ��}����፱Ց������ՙ����ɥ��}�ɑ��}���(����������������}�ɑ��}����፱Ց������������}�ɑ��}���4(����������������}����}����፱Ց������������}����}���4(����������������}����}ɕ٥ͥ��}����፱Ց������������}����}ɕ٥ͥ��}���(�����������}����፱Ց�������}���(�����������}ɕ٥ͥ��}����፱Ց�������}ɕ٥ͥ��}���(��������ѕ�}��͍ɥ�ѥ����፱Ց����ѕ�}��͍ɥ�ѥ���(����������������}����}��}�ѕ�}��͍ɥ�ѥ����፱Ց������������}����}��}�ѕ�}��͍ɥ�ѥ���(�������ѽ}���Օ}�Յ�ѥ���፱Ց���ѽ}���Օ}�Յ�ѥ��(���������}�х���}����}��͍ɥ�ѥ����፱Ց�����}�х���}����}��͍ɥ�ѥ���(�������Ʌ�}�ͽ���፱Ց���Ʌ�}�ͽ��(�����������ѕ�}�Ѐ􁑅ѕѥ������ܜ���4(����4(4(������Ё���􁑈��Ʌ�ͅ�ѥ����������4(������Ё��͕�ѕ�����4(������Ё����ѕ�����4(��������Ё���ѥ��!�͡�̀􁹕܁M�Р4(����������ɕ��ɔ��M1
P�ͽ�ɍ�}ɽ�}��͠�I=4����ՙ����ɥ��}�ɑ��̀�������������ɽܤ����ɽܹͽ�ɍ�}ɽ�}��͠��4(������4(������Ȁ�����Ёɕ��ɐ����ɕ��ɑ̤��4(��������͕�й�ո�4(��������ɕ��ɐ����ՙ����ɥ��}�ɑ��}���4(��������ɕ��ɐ����������}�ɑ��}���4(��������ɕ��ɐ����������}����}���4(��������ɕ��ɐ����������}����}ɕ٥ͥ��}���4(��������ɕ��ɐ�����}���(��������ɕ��ɐ�����}ɕ٥ͥ��}���(��������ɕ��ɐ��ѕ�}��͍ɥ�ѥ���(��������ɕ��ɐ����������}����}��}�ѕ�}��͍ɥ�ѥ���(��������ɕ��ɐ�ѽ}���Օ}�Յ�ѥ��(��������ɕ��ɐ���}�х���}����}��͍ɥ�ѥ���(��������ɕ��ɐ�ͽ�ɍ�}ɽ�}��͠�(��������ɕ��ɐ�Ʌ�}�ͽ��4(��������4(�������������ѥ��!�͡�̹��̡ɕ��ɐ�ͽ�ɍ�}ɽ�}��͠����4(������������ѕ����4(������􁕱͔��4(����������͕�ѕ����4(�����������ѥ��!�͡�̹����ɕ��ɐ�ͽ�ɍ�}ɽ�}��͠��4(�������4(�����4(����������Ց�С�(��������ѽ�聄�(��������ѥ��耉���ՙ����ɥ��}�ɑ���}�����ѕ���(��������ѥ��耉���ՙ����ɥ��}�ɑ��̈�(��������ѥ��}��聹ձ��(��������屽���쁥�͕�ѕ�������ѕ���ɽ���ɕ��ɑ̹����Ѡ��ͽ�ɍ�}��ɵ���ͽ�ɍ��ɵ�Ё��(�������(��������Ё�幌���幍5�I���Q�%�ٕ�ѽ��A���̠��(����ɕ��ɸ�쁥�͕�ѕ�������ѕ���ɽ���ɕ��ɑ̹����Ѡ���幍��}ɕ�Օ��}ɽ����幌��幍�����(�����(4(��ɕ��ɸ��ࠤ�4)�4(4)�����Ё�չ�ѥ���������5��ՙ����ɥ��=ɑ���
�ء쁅�ѽȰ����Q��Ё����4(������Ёɕ��ɑ̀�ɽ��Q�5��ՙ����ɥ��=ɑ��I���ɑ̡���͕
�ءM�ɥ������Q��Ѐ���������4(��ɕ��ɸ�������5��ՙ����ɥ��=ɑ��I���ɑ̡쁅�ѽȰ�ɕ��ɑ̰�ͽ�ɍ��ɵ��耉��؈����4)�4(4)�����Ё��幌��չ�ѥ���������5��ՙ����ɥ��=ɑ���]�ɭ�����쁅�ѽȰ�ݽɭ����	�͔�Ё����4(������Ёɕ��ɑ̀�ɽ��Q�5��ՙ����ɥ��=ɑ��I���ɑ̡�݅�Ё���͕%�ٕ�ѽ��]�ɭ�����ݽɭ����	�͔�Ф��4(��ɕ��ɸ�������5��ՙ����ɥ��=ɑ��I���ɑ̡쁅�ѽȰ�ɕ��ɑ̰�ͽ�ɍ��ɵ��耉��������4)�4(4)�����Ё��幌��չ�ѥ���������5��ՙ����ɥ��=ɑ���]�ɭ����	ՙ��ȡ쁅�ѽȰ�ݽɭ����	ՙ��ȁ����4(������Ёɕ��ɑ̀�ɽ��Q�5��ՙ����ɥ��=ɑ��I���ɑ̡�݅�Ё���͕%�ٕ�ѽ��]�ɭ����	ՙ��ȡݽɭ����	ՙ��Ȥ��4(��ɕ��ɸ�������5��ՙ����ɥ��=ɑ��I���ɑ̡쁅�ѽȰ�ɕ��ɑ̰�ͽ�ɍ��ɵ��耉��������4)�4
