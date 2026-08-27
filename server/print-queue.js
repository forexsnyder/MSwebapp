// A durable outbox, written in the same SQLite transaction as the new ticket.
export function createPrintQueue(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS print_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pick_ticket_id INTEGER NOT NULL UNIQUE REFERENCES pick_tickets(id) ON DELETE CASCADE,
      printer TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','preparing','submitting','submitted','failed','uncertain','skipped')),
      attempts INTEGER NOT NULL DEFAULT 0,
      cups_request_id TEXT,
      error TEXT,
      available_at INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_print_jobs_pending ON print_jobs(status, available_at, id);
  `);
  return {
    enqueue(ticket, printer) {
      return db.prepare(`INSERT OR IGNORE INTO print_jobs (pick_ticket_id, printer, snapshot_json)
        VALUES (?, ?, ?)`).run(ticket.id, printer, JSON.stringify(ticket)).changes;
    },
    claim(now = Date.now()) {
      return db.transaction(() => {
        const job = db.prepare(`SELECT * FROM print_jobs WHERE status = 'queued' AND available_at <= ? ORDER BY id LIMIT 1`).get(now);
        if (!job) return null;
        db.prepare(`UPDATE print_jobs SET status = 'preparing', attempts = attempts + 1,
          updated_at = datetime('now') WHERE id = ?`).run(job.id);
        return { ...job, status: 'preparing', attempts: job.attempts + 1 };
      })();
    },
    recover() {
      // One app service owns this database. After a restart, only pre-submission work is safe to repeat.
      db.prepare(`UPDATE print_jobs SET status = 'queued', updated_at = datetime('now')
        WHERE status = 'preparing'`).run();
      db.prepare(`UPDATE print_jobs SET status = 'uncertain',
        error = 'Server stopped during submission. Check CUPS and the printer before manually reprinting.',
        updated_at = datetime('now') WHERE status = 'submitting'`).run();
    },
    beginSubmission(id) {
      return db.prepare(`UPDATE print_jobs SET status = 'submitting', error = NULL, updated_at = datetime('now')
        WHERE id = ? AND status = 'preparing' AND EXISTS (
          SELECT 1 FROM pick_tickets t WHERE t.id = print_jobs.pick_ticket_id
          AND t.status = 'open' AND t.cancelled_at IS NULL
        )`).run(id).changes === 1;
    },
    finish(id, status, { error = null, requestId = null, availableAt = 0 } = {}) {
      db.prepare(`UPDATE print_jobs SET status = ?, error = ?, cups_request_id = ?, available_at = ?,
        updated_at = datetime('now') WHERE id = ?`).run(status, error?.slice(0, 500) ?? null, requestId, availableAt, id);
    },
    status(ticketId) {
      // Never expose the saved snapshot or command output to the browser.
      const job = ticketId ? db.prepare(`SELECT status, printer, attempts, cups_request_id, error, updated_at
        FROM print_jobs WHERE pick_ticket_id = ?`).get(ticketId) ?? null : null;
      const counts = Object.fromEntries(db.prepare(`SELECT status, COUNT(*) AS count FROM print_jobs GROUP BY status`).all().map(r => [r.status, r.count]));
      const attention = db.prepare(`SELECT pick_ticket_id, status FROM print_jobs
        WHERE status IN ('failed','uncertain') ORDER BY id DESC LIMIT 10`).all();
      return { job, counts, attention };
    },
  };
}
