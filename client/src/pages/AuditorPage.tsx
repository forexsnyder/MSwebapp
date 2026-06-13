import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditLogEntry } from "../types";

type TabId = "audit" | "import" | "export";

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function summarizeAuditRow(r: AuditLogEntry): string {
  const payload = safeJsonParse(r.payload_json) as any;
  if (r.action === "pick_ticket_created") {
    const requester = payload?.requester_name ?? r.actor;
    const lineCount = Array.isArray(payload?.lines) ? payload.lines.length : 0;
    const totalQty = Array.isArray(payload?.lines)
      ? payload.lines.reduce((sum: number, ln: any) => sum + Number(ln?.requested_quantity ?? 0), 0)
      : 0;
    return `Requester ${requester} created ticket #${payload?.id ?? r.entity_id ?? "—"} · ${lineCount} line(s) · total qty ${totalQty}`;
  }
  if (r.action === "pick_ticket_closed") {
    const picker = payload?.closed_by ?? r.actor;
    const when = payload?.closed_at ?? "—";
    return `Picker ${picker} closed ticket #${payload?.id ?? r.entity_id ?? "—"} · closed at ${when}`;
  }
  if (r.action === "pick_ticket_reopened") {
    return `Ticket #${payload?.id ?? r.entity_id ?? "—"} reopened by ${r.actor}`;
  }
  if (r.action === "inventory_csv_imported") {
    return `Imported inventory CSV · ${payload?.rows ?? "—"} row(s) · ${payload?.inserted ?? "—"} inserted · ${payload?.updated ?? "—"} updated`;
  }
  if (r.action === "inventory_reset") {
    return `Inventory reset · ${payload?.before_count ?? "—"} → ${payload?.after_count ?? "—"} row(s)`;
  }
  if (r.action === "pick_queue_cleared") {
    return `Pick queue cleared · ${payload?.before_count ?? "—"} → ${payload?.after_count ?? "—"} ticket(s)`;
  }
  return "";
}

export function AuditorPage() {
  const [tab, setTab] = useState<TabId>("audit");
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actor, setActor] = useState("test_auditor");
  const [adminBusy, setAdminBusy] = useState<null | "resetInventory" | "clearPickQueue" | "clearAuditLog">(null);
  const [adminBanner, setAdminBanner] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; updated: number; rows: number } | null>(
    null,
  );

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/audit-log?limit=200");
    if (!res.ok) {
      setError("Could not load audit log.");
      return;
    }
    setRows((await res.json()) as AuditLogEntry[]);
  }, []);

  useEffect(() => {
    let c = false;
    (async () => {
      setLoading(true);
      await load();
      if (!c) setLoading(false);
    })();
    return () => {
      c = true;
    };
  }, [load]);

  const chainOk = useMemo(() => {
    // Rows are newest-first; verify prev pointer matches next entry's hash.
    for (let i = 0; i < rows.length - 1; i++) {
      const newer = rows[i];
      const older = rows[i + 1];
      if (newer.prev_entry_hash !== older.entry_hash) return false;
    }
    return true;
  }, [rows]);

  useEffect(() => {
    // Keep expanded row sensible when data refreshes.
    if (expandedId == null) return;
    if (!rows.some((r) => r.id === expandedId)) setExpandedId(null);
  }, [expandedId, rows]);

  async function onPickFile(file: File | null) {
    setImportResult(null);
    if (!file) {
      setFileName(null);
      setCsvText("");
      return;
    }
    setFileName(file.name);
    setCsvText(await file.text());
  }

  async function runImport() {
    setError(null);
    setImportResult(null);
    if (!csvText.trim()) {
      setError("Choose a CSV file first.");
      return;
    }
    setImporting(true);
    const res = await fetch("/api/inventory/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: actor.trim() || "unknown", csv: csvText }),
    });
    setImporting(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Import failed.");
      return;
    }
    const body = (await res.json()) as { inserted: number; updated: number; rows: number };
    setImportResult({ inserted: body.inserted, updated: body.updated, rows: body.rows });
    await load();
  }

  async function resetInventoryDb() {
    setError(null);
    setAdminBanner(null);
    const ok = window.confirm(
      "Reset inventory database?\n\nThis will delete all inventory rows and reseed the default demo inventory.",
    );
    if (!ok) return;
    setAdminBusy("resetInventory");
    const res = await fetch("/api/admin/reset-inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: actor.trim() || "unknown" }),
    });
    setAdminBusy(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Reset inventory failed.");
      return;
    }
    const body = (await res.json()) as { before_count: number; after_count: number };
    setAdminBanner(`Inventory reset: ${body.before_count} → ${body.after_count} row(s).`);
    await load();
  }

  async function clearPickQueue() {
    setError(null);
    setAdminBanner(null);
    const ok = window.confirm("Clear pick queue?\n\nThis will delete ALL pick tickets and their lines.");
    if (!ok) return;
    setAdminBusy("clearPickQueue");
    const res = await fetch("/api/admin/clear-pick-queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: actor.trim() || "unknown" }),
    });
    setAdminBusy(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Clear pick queue failed.");
      return;
    }
    const body = (await res.json()) as { before_count: number; after_count: number };
    setAdminBanner(`Pick queue cleared: ${body.before_count} → ${body.after_count} ticket(s).`);
    await load();
  }

  async function clearAuditLogs() {
    setError(null);
    setAdminBanner(null);
    const ok = window.confirm(
      "Clear audit logs?\n\nThis will permanently delete ALL audit log entries (and reset the hash chain).",
    );
    if (!ok) return;
    setAdminBusy("clearAuditLog");
    const res = await fetch("/api/admin/clear-audit-log", { method: "POST" });
    setAdminBusy(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Clear audit logs failed.");
      return;
    }
    const body = (await res.json()) as { before_count: number; after_count: number };
    setAdminBanner(`Audit log cleared: ${body.before_count} → ${body.after_count} entry(s).`);
    await load();
  }

  return (
    <div className="page page--audit">
      {error && <p className="banner banner--error">{error}</p>}

      <div className="ui-card ui-card--padded">
        <h2 className="ui-card__section-title">Auditor</h2>
        <p className="page__intro page__intro--tight">
          Audit log is append-only and hash-chained for tamper evidence. Import/export inventory CSV here.
        </p>

        <div className="inventory-tabs" role="tablist" aria-label="Auditor sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "audit"}
            className={`inventory-tab${tab === "audit" ? " inventory-tab--active" : ""}`}
            onClick={() => setTab("audit")}
          >
            Audit log
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "import"}
            className={`inventory-tab${tab === "import" ? " inventory-tab--active" : ""}`}
            onClick={() => setTab("import")}
          >
            Import inventory CSV
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "export"}
            className={`inventory-tab${tab === "export" ? " inventory-tab--active" : ""}`}
            onClick={() => setTab("export")}
          >
            Export inventory CSV
          </button>
        </div>

        <section className="card" style={{ marginTop: "1rem" }}>
          <h3 className="section-title">Admin actions</h3>
          <p className="muted small">
            Destructive operations for testing/demo. These affect the local SQLite database immediately.
          </p>
          {adminBanner && <p className="banner banner--success">{adminBanner}</p>}
          <label className="field" style={{ maxWidth: 420 }}>
            <span className="field__label">Actor (used for audit entries when applicable)</span>
            <input className="field__input" value={actor} onChange={(e) => setActor(e.target.value)} />
          </label>
          <div className="row-actions" style={{ marginTop: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn--danger-ghost"
              onClick={resetInventoryDb}
              disabled={adminBusy !== null || importing}
            >
              {adminBusy === "resetInventory" ? "Resetting…" : "Reset inventory database"}
            </button>
            <button
              type="button"
              className="btn btn--danger-ghost"
              onClick={clearPickQueue}
              disabled={adminBusy !== null || importing}
            >
              {adminBusy === "clearPickQueue" ? "Resetting…" : "Reset pick queue"}
            </button>
            <button
              type="button"
              className="btn btn--danger-ghost"
              onClick={clearAuditLogs}
              disabled={adminBusy !== null || importing}
            >
              {adminBusy === "clearAuditLog" ? "Resetting…" : "Reset audit logs"}
            </button>
          </div>
        </section>

        {tab === "audit" && (
          <>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="muted">No audit entries yet.</p>
            ) : (
              <>
                <div className="audit-table-scroll">
                  <table className="data-table data-table--compact data-table--audit">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>When</th>
                        <th>Actor</th>
                        <th>Event</th>
                        <th>Summary</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const expanded = expandedId === r.id;
                        const payload = safeJsonParse(r.payload_json);
                        const summary = summarizeAuditRow(r);
                        return (
                          <>
                            <tr key={r.id}>
                              <td className="mono small">{r.id}</td>
                              <td className="muted small">{r.created_at}</td>
                              <td>{r.actor}</td>
                              <td className="mono small">
                                {r.action}{" "}
                                <span className="muted small">
                                  · {r.entity}
                                  {r.entity_id ? ` #${r.entity_id}` : ""}
                                </span>
                              </td>
                              <td className="muted small">{summary || "—"}</td>
                              <td>
                                <button
                                  type="button"
                                  className="btn btn--small"
                                  onClick={() => setExpandedId((cur) => (cur === r.id ? null : r.id))}
                                >
                                  {expanded ? "Hide" : "Details"}
                                </button>
                              </td>
                            </tr>
                            {expanded && (
                              <tr key={`${r.id}-details`}>
                                <td colSpan={6}>
                                  <div className="ui-card ui-card--padded audit-detail-card" style={{ margin: "0.5rem 0" }}>
                                    <div className="row-actions" style={{ justifyContent: "space-between" }}>
                                      <div className="muted small">
                                        <strong>Event</strong>: <span className="mono">{r.action}</span> ·{" "}
                                        <strong>Actor</strong>: <span className="mono">{r.actor}</span> ·{" "}
                                        <strong>When</strong>: <span className="mono">{r.created_at}</span>
                                      </div>
                                      <div className="muted small">
                                        {chainOk ? null : (
                                          <span className="banner banner--error" style={{ margin: 0 }}>
                                            Hash chain mismatch in loaded window
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    {r.action === "pick_ticket_created" && payload && typeof payload === "object" ? (
                                      <div style={{ marginTop: "0.75rem" }}>
                                        <p className="muted small" style={{ marginBottom: "0.5rem" }}>
                                          <strong>Requested parts</strong>
                                        </p>
                                        <div className="audit-lines audit-lines--cards">
                                          {(Array.isArray((payload as any).lines) ? (payload as any).lines : []).map(
                                            (ln: any) => (
                                              <div
                                                key={String(ln?.id ?? ln?.inventory_part_id ?? Math.random())}
                                                className="audit-line-card"
                                              >
                                                <div className="audit-line-card__row">
                                                  <strong>MO</strong>
                                                  <span className="mono">{ln?.manufacturing_order_id ?? "—"}</span>
                                                </div>
                                                <div className="audit-line-card__row">
                                                  <strong>Component</strong>
                                                  <span className="mono">
                                                    {ln?.component_part_id ?? "—"} rev {ln?.component_part_revision_id ?? "—"}
                                                  </span>
                                                </div>
                                                <div className="audit-line-card__row">
                                                  <strong>Requested qty</strong>
                                                  <span>{ln?.requested_quantity ?? "—"}</span>
                                                </div>
                                                <div className="audit-line-card__row">
                                                  <strong>To-issue qty</strong>
                                                  <span>{ln?.to_issue_quantity ?? "—"}</span>
                                                </div>
                                                <div className="audit-line-card__row">
                                                  <strong>MO status</strong>
                                                  <span className="mono small">{ln?.mo_status_code_description ?? "—"}</span>
                                                </div>
                                                <div className="audit-line-card__row">
                                                  <strong>Inventory part</strong>
                                                  <span className="mono small">
                                                    {ln?.part_id ?? "—"} rev {ln?.part_revision_id ?? "—"}
                                                  </span>
                                                </div>
                                              </div>
                                            ),
                                          )}
                                        </div>
                                      </div>
                                    ) : null}

                                    <details style={{ marginTop: "0.75rem" }}>
                                      <summary className="muted small">Raw payload (JSON)</summary>
                                      <pre className="mono small" style={{ whiteSpace: "pre-wrap", marginTop: "0.5rem" }}>
                                        {r.payload_json}
                                      </pre>
                                    </details>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {tab === "import" && (
          <section className="card" style={{ marginTop: "1rem" }}>
            <h3 className="section-title">Upload latest inventory CSV</h3>
            <label className="field">
              <span className="field__label">Actor (for audit log)</span>
              <input className="field__input" value={actor} onChange={(e) => setActor(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">CSV file</span>
              <input
                className="field__input"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              />
              {fileName && <div className="muted small">Selected: {fileName}</div>}
            </label>
            <button type="button" className="btn btn--primary" disabled={importing} onClick={runImport}>
              {importing ? "Importing…" : "Import CSV"}
            </button>
            {importResult && (
              <p className="banner banner--success" style={{ marginTop: "0.75rem" }}>
                Imported {importResult.rows} row(s): {importResult.inserted} inserted, {importResult.updated} updated.
              </p>
            )}
            <details style={{ marginTop: "0.75rem" }}>
              <summary className="muted small">Expected CSV columns</summary>
              <p className="muted small" style={{ marginTop: "0.5rem" }}>
                part_id, part_revision_id, item_description, on_hand_quantity, inventory_abbreviation_code,
                default_inventory_location_id, manufacturing_order_id, component_order_id, component_part_id,
                component_part_revision_id, to_issue_quantity, mo_status_code_description
              </p>
            </details>
          </section>
        )}

        {tab === "export" && (
          <section className="card" style={{ marginTop: "1rem" }}>
            <h3 className="section-title">Export on-site inventory</h3>
            <p className="muted small">Downloads a CSV snapshot of the current `inventory_parts` table.</p>
            <a className="btn btn--primary" href="/api/inventory/export.csv">
              Download inventory CSV
            </a>
          </section>
        )}
      </div>
    </div>
  );
}
