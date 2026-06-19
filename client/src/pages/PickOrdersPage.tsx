import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import type { PickTicket, PickTicketSummary, RequestType } from "../types";
import { printPickTicket, printPickTickets } from "../utils/printPickTicket";

type QueueTab = "open" | "closed";

function formatTicketRef(id: number) {
  return `TICKET-${String(id).padStart(6, "0")}`;
}

function requestTypeLabel(type: RequestType) {
  if (type === "scrap") return "Scrap";
  if (type === "return") return "Return";
  return "Issue";
}

function statusBadgeClass(status: PickTicket["status"]) {
  if (status === "closed") return "badge badge--fulfilled";
  if (status === "cancelled") return "badge badge--cancelled";
  return "badge badge--in_progress";
}

export function PickOrdersPage() {
  const { user } = useAuth();
  const [queueTab, setQueueTab] = useState<QueueTab>("open");
  const [searchQuery, setSearchQuery] = useState("");
  const [tickets, setTickets] = useState<PickTicketSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<PickTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pickerName, setPickerName] = useState("");
  const [lineLots, setLineLots] = useState<Record<number, string>>({});
  const [closing, setClosing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printingAll, setPrintingAll] = useState(false);

  const loadList = useCallback(
    async (statusOverride?: QueueTab) => {
      setError(null);
      const status = statusOverride ?? queueTab;
      const params = new URLSearchParams({ status });
      const q = searchQuery.trim();
      if (q) params.set("q", q);
      const res = await fetch(`/api/pick-tickets?${params}`);
      if (!res.ok) {
        setError("Could not load pick tickets.");
        return;
      }
      setTickets((await res.json()) as PickTicketSummary[]);
    },
    [queueTab, searchQuery],
  );

  useEffect(() => {
    let c = false;
    const t = window.setTimeout(() => {
      (async () => {
        setLoading(true);
        await loadList();
        if (!c) setLoading(false);
      })();
    }, searchQuery.trim() ? 250 : 0);
    return () => {
      c = true;
      window.clearTimeout(t);
    };
  }, [loadList, searchQuery]);

  useEffect(() => {
    setSelectedId(null);
  }, [queueTab]);

  useEffect(() => {
    if (user && !pickerName) setPickerName(user);
  }, [user, pickerName]);

  const loadSelected = useCallback(async (id: number) => {
    setError(null);
    setSuccess(null);
    const res = await fetch(`/api/pick-tickets/${id}`);
    if (!res.ok) {
      setError("Could not load pick ticket.");
      return;
    }
    const ticket = (await res.json()) as PickTicket;
    setSelected(ticket);
    const lots: Record<number, string> = {};
    for (const ln of ticket.lines) {
      lots[ln.id] =
        ticket.status === "open" ? "" : ln.lot_number || ln.inventory_lot_number || "";
    }
    setLineLots(lots);
  }, []);

  useEffect(() => {
    if (selectedId == null) {
      setSelected(null);
      setLineLots({});
      return;
    }
    void loadSelected(selectedId);
  }, [selectedId, loadSelected]);

  const emptyMessage = useMemo(() => {
    if (searchQuery.trim()) {
      return `No ${queueTab} pick tickets match your search.`;
    }
    return queueTab === "open"
      ? "No open pick tickets. Create one under Request."
      : "No closed pick tickets yet.";
  }, [queueTab, searchQuery]);

  const completeLabel = useMemo(() => {
    if (!selected) return "Complete ticket";
    if (selected.request_type === "return") return "Complete return";
    if (selected.request_type === "scrap") return "Complete scrap";
    return "Complete pick";
  }, [selected]);

  async function closeTicket() {
    if (!selected) return;
    const name = pickerName.trim();
    if (!name) {
      setError("Enter picker name to close the ticket.");
      return;
    }
    if (selected.status !== "open") return;
    setClosing(true);
    setError(null);
    setSuccess(null);
    const res = await fetch(`/api/pick-tickets/${selected.id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        picker_name: name,
        line_lots: selected.lines.map((ln) => ({
          line_id: ln.id,
          lot_number: lineLots[ln.id] ?? ln.lot_number,
        })),
      }),
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
    setSuccess(
      `Ticket completed. ${updated.requester_name} was notified that this order was picked.`,
    );
  }

  async function cancelTicket() {
    if (!selected || selected.status !== "open") return;
    const name = pickerName.trim();
    if (!name) {
      setError("Enter picker name to cancel the ticket.");
      return;
    }
    if (
      !window.confirm(
        `Cancel ${formatTicketRef(selected.id)}? The requester will be notified and this ticket will be removed from the pick queue.`,
      )
    ) {
      return;
    }
    setCancelling(true);
    setError(null);
    setSuccess(null);
    const res = await fetch(`/api/pick-tickets/${selected.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancelled_by: name }),
    });
    setCancelling(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not cancel ticket.");
      return;
    }
    const updated = (await res.json()) as PickTicket;
    setSelected(updated);
    await loadList();
    setSuccess(`Ticket cancelled. ${updated.requester_name} was notified.`);
  }

  async function reopenTicket() {
    if (!selected || selected.status !== "closed") return;
    const name = pickerName.trim();
    if (!name) {
      setError("Enter picker name to reopen the ticket.");
      return;
    }
    if (
      !window.confirm(
        `Reopen ${formatTicketRef(selected.id)}? It will return to the Open queue and inventory counts will be reversed.`,
      )
    ) {
      return;
    }
    setReopening(true);
    setError(null);
    setSuccess(null);
    const res = await fetch(`/api/pick-tickets/${selected.id}/reopen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reopened_by: name }),
    });
    setReopening(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not reopen ticket.");
      return;
    }
    const updated = (await res.json()) as PickTicket;
    setQueueTab("open");
    setSelectedId(updated.id);
    await loadList("open");
    setSelected(updated);
    const lots: Record<number, string> = {};
    for (const ln of updated.lines) {
      lots[ln.id] = "";
    }
    setLineLots(lots);
    setSuccess(`Ticket reopened and moved to the Open queue.`);
  }

  function ticketForPrint(ticket: PickTicket): PickTicket {
    if (selected?.id !== ticket.id) return ticket;
    return {
      ...ticket,
      lines: ticket.lines.map((ln) => ({
        ...ln,
        lot_number: lineLots[ln.id] ?? ln.lot_number,
      })),
    };
  }

  async function fetchFullTicket(id: number): Promise<PickTicket | null> {
    const res = await fetch(`/api/pick-tickets/${id}`);
    if (!res.ok) return null;
    return (await res.json()) as PickTicket;
  }

  function handlePrintTicket() {
    if (!selected) return;
    if (selected.lines.length === 0) {
      setError("This ticket has no lines to print.");
      return;
    }
    setError(null);
    setPrinting(true);
    try {
      printPickTicket(ticketForPrint(selected), {
        lotByLineId: Object.fromEntries(selected.lines.map((ln) => [ln.id, lineLots[ln.id] ?? ""])),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Print failed.");
    } finally {
      setPrinting(false);
    }
  }

  async function handlePrintAll() {
    if (tickets.length === 0) return;
    setError(null);
    setPrintingAll(true);
    try {
      const full = await Promise.all(tickets.map((t) => fetchFullTicket(t.id)));
      const printable = full.filter((t): t is PickTicket => t !== null);
      if (printable.length === 0) {
        setError("Could not load tickets for printing.");
        return;
      }
      const label = queueTab === "open" ? "Open pick tickets" : "Closed pick tickets";
      printPickTickets(
        printable.map((t) => ticketForPrint(t)),
        {
          title: `${label} (${printable.length})`,
          lotByLineId: selected
            ? Object.fromEntries(selected.lines.map((ln) => [ln.id, lineLots[ln.id] ?? ""]))
            : undefined,
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Print failed.");
    } finally {
      setPrintingAll(false);
    }
  }

  return (
    <div className="page pick-layout">
      <div className="ui-card ui-card--padded pick-column">
        <h2 className="ui-card__section-title">Pick tickets</h2>
        <p className="page__intro page__intro--tight">
          Search by user, ticket #, date, MO, or part number. Toggle open vs closed queues.
        </p>

        <div className="pick-queue-toolbar">
          <div className="inventory-tabs pick-queue-tabs" role="tablist" aria-label="Pick ticket queue">
            <button
              type="button"
              role="tab"
              aria-selected={queueTab === "open"}
              className={`inventory-tab${queueTab === "open" ? " inventory-tab--active" : ""}`}
              onClick={() => setQueueTab("open")}
            >
              Open
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={queueTab === "closed"}
              className={`inventory-tab${queueTab === "closed" ? " inventory-tab--active" : ""}`}
              onClick={() => setQueueTab("closed")}
            >
              Closed
            </button>
          </div>
          <label className="field pick-queue-search">
            <span className="field__label">Search</span>
            <input
              className="field__input"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="User, ticket, date, MO, part #…"
              aria-label="Search pick tickets"
            />
          </label>
          <div className="pick-queue-print-actions">
            <button
              type="button"
              className="btn btn--ghost btn--small"
              disabled={loading || printingAll || tickets.length === 0}
              onClick={() => void handlePrintAll()}
            >
              {printingAll ? "Preparing…" : `Print all (${tickets.length})`}
            </button>
          </div>
        </div>

        {error && <p className="banner banner--error">{error}</p>}
        {success && <p className="banner banner--success">{success}</p>}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : tickets.length === 0 ? (
          <p className="muted">{emptyMessage}</p>
        ) : (
          <ul className="request-list">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`request-list__btn${selectedId === t.id ? " request-list__btn--on" : ""}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <span className="request-list__ref">{formatTicketRef(t.id)}</span>
                  <span className="request-list__sub">
                    {t.requester_name}
                    {t.manufacturing_order_id ? (
                      <>
                        {" "}
                        · MO <span className="mono">{t.manufacturing_order_id}</span>
                      </>
                    ) : null}
                    {queueTab === "closed" && t.closed_at ? (
                      <>
                        {" "}
                        · <span className="mono">{t.closed_at}</span>
                      </>
                    ) : (
                      <>
                        {" "}
                        · <span className="mono">{t.created_at}</span>
                      </>
                    )}
                  </span>
                  <span className={`badge badge--type badge--type-${t.request_type}`}>
                    {requestTypeLabel(t.request_type)}
                  </span>
                  <span className="badge">{t.line_count} lines</span>
                  <span className={statusBadgeClass(t.status)}>{t.status}</span>
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
                <h2 className="pick-detail__title">{formatTicketRef(selected.id)}</h2>
                <p className="muted">
                  <span className={`badge badge--type badge--type-${selected.request_type}`}>
                    {requestTypeLabel(selected.request_type)}
                  </span>{" "}
                  · Requester: <strong>{selected.requester_name}</strong> · Ordered{" "}
                  <span className="mono">{selected.created_at}</span>
                </p>
                <p className="muted small pick-detail__mo">
                  Manufacturing Order ID:{" "}
                  <span className="mono">{selected.manufacturing_order_id || "—"}</span>
                </p>
                {selected.request_type === "return" && selected.status === "open" && (
                  <p className="banner banner--info pick-detail__return-note">
                    Return ticket — verify parts and quantities, then complete return to add stock back.
                  </p>
                )}
                {selected.status === "cancelled" && (
                  <p className="muted small" style={{ margin: 0 }}>
                    Cancelled by <strong>{selected.cancelled_by ?? "—"}</strong>{" "}
                    {selected.cancelled_at ? (
                      <>
                        · <span className="mono">{selected.cancelled_at}</span>
                      </>
                    ) : null}
                  </p>
                )}
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
              <div className="pick-detail__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  disabled={printing}
                  onClick={handlePrintTicket}
                >
                  {printing ? "Preparing…" : "Print ticket"}
                </button>
                {(selected.status === "open" || selected.status === "closed") && (
                  <input
                    className="field__input"
                    style={{ minHeight: 40, padding: "0.45rem 0.65rem" }}
                    value={pickerName}
                    onChange={(e) => setPickerName(e.target.value)}
                    placeholder="Picker name"
                    aria-label="Picker name"
                  />
                )}
                {selected.status === "closed" && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    disabled={reopening}
                    onClick={() => void reopenTicket()}
                  >
                    {reopening ? "Reopening…" : "Reopen ticket"}
                  </button>
                )}
                {selected.status === "open" && (
                  <>
                    <button
                      type="button"
                      className="btn btn--danger-ghost btn--small"
                      disabled={cancelling || closing || reopening}
                      onClick={cancelTicket}
                    >
                      {cancelling ? "Cancelling…" : "Cancel ticket"}
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary btn--small"
                      disabled={closing || cancelling || reopening}
                      onClick={closeTicket}
                    >
                      {closing ? "Completing…" : completeLabel}
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
                    <th>MO#</th>
                    <th>Part #</th>
                    <th>Rev ID</th>
                    <th>Requested</th>
                    <th>On Hand</th>
                    <th>Inv. ABBREV</th>
                    <th>Location</th>
                    <th>Lot #</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((ln) => (
                    <tr key={ln.id}>
                      <td className="mono small">{ln.manufacturing_order_id}</td>
                      <td className="mono small">{ln.part_id}</td>
                      <td className="mono small">{ln.part_revision_id}</td>
                      <td>{ln.requested_quantity}</td>
                      <td>{ln.on_hand_quantity}</td>
                      <td className="mono small">{ln.inventory_abbreviation_code}</td>
                      <td className="mono small">{ln.default_inventory_location_id}</td>
                      <td className="pick-lot-cell">
                        {selected.status === "open" ? (
                          <input
                            type="text"
                            className="field__input pick-lot-handwrite"
                            value={lineLots[ln.id] ?? ""}
                            onChange={(e) =>
                              setLineLots((prev) => ({ ...prev, [ln.id]: e.target.value }))
                            }
                            placeholder=""
                            aria-label={`Lot number for ${ln.part_id} ${ln.part_revision_id}`}
                          />
                        ) : (
                          <div className="pick-lot-handwrite pick-lot-handwrite--readonly">
                            {lineLots[ln.id] || ln.lot_number || ""}
                          </div>
                        )}
                      </td>
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
