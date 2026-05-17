import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import type { PickTicket, PickTicketSummary, UserPickTicketHistory } from "../types";

type HistoryTab = "requested" | "picked";

function formatTicketRef(id: number) {
  return `TICKET-${String(id).padStart(6, "0")}`;
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function HistoryTicketDetail({ ticketId }: { ticketId: number }) {
  const [ticket, setTicket] = useState<PickTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/pick-tickets/${ticketId}`);
      if (!res.ok) {
        if (!cancelled) setError("Could not load ticket lines.");
        if (!cancelled) setLoading(false);
        return;
      }
      if (!cancelled) setTicket((await res.json()) as PickTicket);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  if (loading) return <p className="muted small history-detail">Loading lines…</p>;
  if (error) return <p className="banner banner--error history-detail">{error}</p>;
  if (!ticket) return null;

  return (
    <div className="history-detail">
      <div className="table-scroll">
        <table className="data-table data-table--nested">
          <thead>
            <tr>
              <th>MO</th>
              <th>Component</th>
              <th>Qty</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {ticket.lines.map((ln) => (
              <tr key={ln.id}>
                <td className="mono small">{ln.manufacturing_order_id}</td>
                <td className="mono">{ln.component_part_id}</td>
                <td>{ln.requested_quantity}</td>
                <td className="mono small">{ln.default_inventory_location_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryTicketList({
  tickets,
  mode,
  expandedId,
  onToggle,
}: {
  tickets: PickTicketSummary[];
  mode: HistoryTab;
  expandedId: number | null;
  onToggle: (id: number) => void;
}) {
  if (tickets.length === 0) {
    return (
      <p className="muted">
        {mode === "requested"
          ? "No requests yet. Place an order on the Request screen."
          : "No completed picks yet. Close tickets on the Pick screen."}
      </p>
    );
  }

  return (
    <ul className="request-list history-list">
      {tickets.map((t) => {
        const expanded = expandedId === t.id;
        return (
          <li key={t.id} className="history-list__item">
            <button
              type="button"
              className={`request-list__btn history-list__btn${expanded ? " request-list__btn--on" : ""}`}
              onClick={() => onToggle(t.id)}
              aria-expanded={expanded}
            >
              <span className="request-list__ref">{formatTicketRef(t.id)}</span>
              <span className="request-list__sub">
                {mode === "requested" ? (
                  <>
                    {t.line_count} line{t.line_count === 1 ? "" : "s"}
                    {t.manufacturing_order_id ? (
                      <>
                        {" "}
                        · MO <span className="mono">{t.manufacturing_order_id}</span>
                      </>
                    ) : null}{" "}
                    · <span className="mono">{formatWhen(t.created_at)}</span>
                  </>
                ) : (
                  <>
                    For {t.requester_name}
                    {t.manufacturing_order_id ? (
                      <>
                        {" "}
                        · MO <span className="mono">{t.manufacturing_order_id}</span>
                      </>
                    ) : null}{" "}
                    · picked <span className="mono">{formatWhen(t.closed_at)}</span>
                  </>
                )}
              </span>
              <span className={`badge badge--type badge--type-${t.request_type}`}>
                {t.request_type}
              </span>
              <span
                className={`badge${
                  t.status === "closed"
                    ? " badge--fulfilled"
                    : t.status === "cancelled"
                      ? " badge--cancelled"
                      : " badge--in_progress"
                }`}
              >
                {t.status}
              </span>
            </button>
            {expanded ? <HistoryTicketDetail ticketId={t.id} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function HistoryPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<HistoryTab>("requested");
  const [history, setHistory] = useState<UserPickTicketHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    if (!user) return;
    setError(null);
    const res = await fetch(`/api/history?user=${encodeURIComponent(user)}`);
    if (!res.ok) {
      setError("Could not load history.");
      return;
    }
    setHistory((await res.json()) as UserPickTicketHistory);
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      setLoading(true);
      await loadHistory();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loadHistory]);

  useEffect(() => {
    setExpandedId(null);
  }, [tab]);

  function toggleTicket(id: number) {
    setExpandedId((cur) => (cur === id ? null : id));
  }

  const tickets = tab === "requested" ? (history?.requested ?? []) : (history?.picked ?? []);

  return (
    <div className="page">
      <div className="ui-card ui-card--padded">
        <p className="page__intro page__intro--tight">
          Review pick tickets you submitted as requester and tickets you completed as picker.
        </p>

        {user ? (
          <p className="muted small">
            Signed in as <span className="mono">{user}</span>
          </p>
        ) : null}

        {error && <p className="banner banner--error">{error}</p>}

        <div className="inventory-tabs history-tabs" role="tablist" aria-label="History views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "requested"}
            className={`inventory-tab${tab === "requested" ? " inventory-tab--active" : ""}`}
            onClick={() => setTab("requested")}
          >
            My requests
            {history ? ` (${history.requested.length})` : ""}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "picked"}
            className={`inventory-tab${tab === "picked" ? " inventory-tab--active" : ""}`}
            onClick={() => setTab("picked")}
          >
            My picks
            {history ? ` (${history.picked.length})` : ""}
          </button>
        </div>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : !user ? (
          <p className="muted">Sign in to view your history.</p>
        ) : (
          <HistoryTicketList
            tickets={tickets}
            mode={tab}
            expandedId={expandedId}
            onToggle={toggleTicket}
          />
        )}
      </div>
    </div>
  );
}
