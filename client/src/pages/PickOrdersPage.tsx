import { useCallback, useEffect, useState } from "react";
import type { PickTicket, PickTicketSummary } from "../types";

export function PickOrdersPage() {
  const [tickets, setTickets] = useState<PickTicketSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<PickTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerName, setPickerName] = useState("");
  const [closing, setClosing] = useState(false);

  const loadList = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/pick-tickets");
    if (!res.ok) {
      setError("Could not load pick tickets.");
      return;
    }
    setTickets((await res.json()) as PickTicketSummary[]);
  }, []);

  useEffect(() => {
    let c = false;
    (async () => {
      setLoading(true);
      await loadList();
      if (!c) setLoading(false);
    })();
    return () => {
      c = true;
    };
  }, [loadList]);

  const loadSelected = useCallback(async (id: number) => {
    setError(null);
    const res = await fetch(`/api/pick-tickets/${id}`);
    if (!res.ok) {
      setError("Could not load pick ticket.");
      return;
    }
    setSelected((await res.json()) as PickTicket);
  }, []);

  useEffect(() => {
    if (selectedId == null) {
      setSelected(null);
      return;
    }
    void loadSelected(selectedId);
  }, [selectedId, loadSelected]);

  async function closeTicket() {
    if (!selected) return;
    const name = pickerName.trim();
    if (!name) {
      setError("Enter picker name to close the ticket.");
      return;
    }
    if (selected.status === "closed") return;
    setClosing(true);
    setError(null);
    const res = await fetch(`/api/pick-tickets/${selected.id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picker_name: name }),
    });
    setClosing(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not close ticket.");
      return;
    }
    const updated = (await res.json()) as PickTicket;
    setSelected(updated);
    await loadList();
  }

  return (
    <div className="page pick-layout">
      <div className="ui-card ui-card--padded pick-column">
        <h2 className="ui-card__section-title">Pick tickets</h2>
        <p className="page__intro page__intro--tight">
          Select a ticket to see all line items and where to pick them.
        </p>
        {error && <p className="banner banner--error">{error}</p>}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : tickets.length === 0 ? (
          <p className="muted">No pick tickets yet. Create one under Request.</p>
        ) : (
          <ul className="request-list">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`request-list__btn${selectedId === t.id ? " request-list__btn--on" : ""}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <span className="request-list__ref">TICKET-{String(t.id).padStart(6, "0")}</span>
                  <span className="request-list__sub">{t.requester_name}</span>
                  <span className="badge">{t.line_count} lines</span>
                  <span className={`badge ${t.status === "closed" ? "badge--fulfilled" : "badge--in_progress"}`}>
                    {t.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pick-detail ui-card ui-card--padded">
        {!selected ? (
          <p className="muted">Select a pick ticket to view its lines.</p>
        ) : (
          <>
            <div className="pick-detail__head">
              <div>
                <h2 className="pick-detail__title">
                  TICKET-{String(selected.id).padStart(6, "0")}
                </h2>
                <p className="muted">
                  Requester: <strong>{selected.requester_name}</strong> · Ordered{" "}
                  <span className="mono">{selected.created_at}</span>
                </p>
                {selected.status === "closed" && (
                  <p className="muted small" style={{ margin: 0 }}>
                    Closed by <strong>{selected.closed_by ?? "—"}</strong>{" "}
                    {selected.closed_at ? (
                      <>
                        · <span className="mono">{selected.closed_at}</span>
                      </>
                    ) : null}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                {selected.status !== "closed" && (
                  <>
                    <input
                      className="field__input"
                      style={{ minHeight: 40, padding: "0.45rem 0.65rem" }}
                      value={pickerName}
                      onChange={(e) => setPickerName(e.target.value)}
                      placeholder="Picker name"
                      aria-label="Picker name"
                    />
                    <button type="button" className="btn btn--primary btn--small" disabled={closing} onClick={closeTicket}>
                      {closing ? "Closing…" : "Complete ticket"}
                    </button>
                  </>
                )}
                <button type="button" className="btn btn--ghost btn--small" onClick={() => setSelectedId(null)}>
                  Close view
                </button>
              </div>
            </div>

            <div className="table-scroll">
              <table className="data-table data-table--wide">
                <thead>
                  <tr>
                    <th>Part ID</th>
                    <th>Part Rev ID</th>
                    <th>Requested</th>
                    <th>On Hand Qty</th>
                    <th>Inv. Abbrev Code</th>
                    <th>Default Inv. Location ID</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((ln) => (
                    <tr key={ln.id}>
                      <td className="mono">{ln.part_id}</td>
                      <td className="mono small">{ln.part_revision_id}</td>
                      <td>{ln.requested_quantity}</td>
                      <td>{ln.on_hand_quantity}</td>
                      <td className="mono small">{ln.inventory_abbreviation_code}</td>
                      <td className="mono small">{ln.default_inventory_location_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
