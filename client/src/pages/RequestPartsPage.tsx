import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Part } from "../types";
import { SearchableSelect } from "../components/SearchableSelect";
import { useAuth } from "../auth/AuthContext";

const DUMMY_REQUESTER_NAME = "Test_Steve";

type RequestType = "issue" | "scrap" | "return";

const REQUEST_TYPE_OPTIONS: { value: RequestType; label: string }[] = [
  { value: "issue", label: "Issue" },
  { value: "scrap", label: "Scrap" },
  { value: "return", label: "Return" },
];

export function RequestPartsPage() {
  const { user } = useAuth();
  const requesterName = user?.trim() || DUMMY_REQUESTER_NAME;
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cart, setCart] = useState<Record<number, number>>({});
  const [createdTicketId, setCreatedTicketId] = useState<number | null>(null);
  const [requestType, setRequestType] = useState<RequestType>("issue");
  const [selectedInventoryPartId, setSelectedInventoryPartId] = useState("");
  const [selectedMoId, setSelectedMoId] = useState("");
  const [selectedComponentPartId, setSelectedComponentPartId] = useState("");
  const [qtyDraft, setQtyDraft] = useState("1");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/parts");
      if (!res.ok) {
        if (!cancelled) setError("Could not load inventory parts.");
        return;
      }
      const data = (await res.json()) as Part[];
      if (!cancelled) setParts(data);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cartItems = useMemo(() => {
    const byId = new Map(parts.map((p) => [p.id, p] as const));
    return Object.entries(cart)
      .map(([idStr, qty]) => {
        const id = Number(idStr);
        const part = byId.get(id);
        if (!part) return null;
        return { part, requested_quantity: qty };
      })
      .filter(Boolean) as { part: Part; requested_quantity: number }[];
  }, [cart, parts]);

  const cartItemsByMo = useMemo(() => {
    const order: string[] = [];
    const groups = new Map<string, { part: Part; requested_quantity: number }[]>();
    for (const row of cartItems) {
      const mo = row.part.manufacturing_order_id;
      if (!groups.has(mo)) {
        groups.set(mo, []);
        order.push(mo);
      }
      groups.get(mo)!.push(row);
    }
    return order.map((mo) => ({
      manufacturing_order_id: mo,
      rows: groups.get(mo)!,
    }));
  }, [cartItems]);

  const moOptions = useMemo(() => {
    return Array.from(new Set(parts.map((p) => p.manufacturing_order_id)))
      .sort((a, b) => a.localeCompare(b))
      .map((mo) => ({ value: mo, label: mo }));
  }, [parts]);

  const partSearchOptions = useMemo(() => {
    return parts
      .slice()
      .sort((a, b) => {
        const aLabel = `${a.part_id} ${a.item_description}`;
        const bLabel = `${b.part_id} ${b.item_description}`;
        return aLabel.localeCompare(bLabel);
      })
      .map((p) => {
        const description = p.item_description?.trim() || "No item description";
        return {
          value: String(p.id),
          label: `${p.part_id} - ${description}`,
          searchText: [p.part_id, p.item_description].join(" "),
        };
      });
  }, [parts]);

  const partsForMo = useMemo(() => {
    if (!selectedMoId) return [];
    return parts.filter((p) => p.manufacturing_order_id === selectedMoId);
  }, [parts, selectedMoId]);

  const componentPartOptions = useMemo(() => {
    const ids = Array.from(new Set(partsForMo.map((p) => p.component_part_id)));
    ids.sort((a, b) => a.localeCompare(b));
    return ids.map((id) => ({ value: id, label: id }));
  }, [partsForMo]);

  const selectedPartBySearch = useMemo(() => {
    if (!selectedInventoryPartId) return null;
    return parts.find((p) => String(p.id) === selectedInventoryPartId) ?? null;
  }, [parts, selectedInventoryPartId]);

  const selectedPartByMoComponent = useMemo(() => {
    if (!selectedMoId || !selectedComponentPartId) return null;
    const matches = parts
      .filter(
        (p) =>
          p.manufacturing_order_id === selectedMoId && p.component_part_id === selectedComponentPartId,
      )
      .slice()
      .sort((a, b) => (a.part_id + a.part_revision_id).localeCompare(b.part_id + b.part_revision_id));
    return matches[0] ?? null;
  }, [parts, selectedComponentPartId, selectedMoId]);

  const selectedPart = selectedPartBySearch ?? selectedPartByMoComponent;

  const selectedPartInShop = useMemo(() => {
    if (!selectedPart) return false;
    return selectedPart.mo_status_code_description.includes("In Shop");
  }, [selectedPart]);

  function selectInventoryPart(value: string) {
    setSelectedInventoryPartId(value);
    const part = parts.find((p) => String(p.id) === value);
    if (!part) return;
    setSelectedMoId(part.manufacturing_order_id);
    setSelectedComponentPartId(part.component_part_id);
  }

  function selectMo(value: string) {
    setSelectedMoId(value);
    setSelectedComponentPartId("");
  }

  function selectComponentPart(value: string) {
    setSelectedComponentPartId(value);
  }

  function addSelectedToCart() {
    setError(null);
    setCreatedTicketId(null);
    if (!selectedInventoryPartId && (!selectedMoId || !selectedComponentPartId)) {
      setError("Select a Manufacturing Order ID and Component Part ID, or search by Part ID / Item Description.");
      return;
    }
    if (!selectedPart) {
      setError("No inventory row matched the selected fields.");
      return;
    }
    if (!selectedPartInShop) {
      setError('This item cannot be added unless the MO Status Code Description contains "In Shop".');
      return;
    }
    const q = Number(qtyDraft);
    if (!Number.isInteger(q) || q < 0) {
      setError("Quantity must be a whole number ≥ 0.");
      return;
    }
    setCart((prev) => ({ ...prev, [selectedPart.id]: q }));
    setQtyDraft("1");
    setSelectedInventoryPartId("");
    setSelectedMoId("");
    setSelectedComponentPartId("");
  }

  function removeFromCart(id: number) {
    setCart((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function setCartQty(id: number, raw: string) {
    const q = Number(raw);
    if (!Number.isInteger(q) || q < 0) return;
    setCart((prev) => ({ ...prev, [id]: q }));
  }

  async function checkout(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatedTicketId(null);
    const name = requesterName;
    if (cartItems.length === 0) {
      setError("Cart is empty.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/pick-tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requester_name: name,
        request_type: requestType,
        lines: cartItems.map((ci) => ({
          inventory_part_id: ci.part.id,
          requested_quantity: ci.requested_quantity,
        })),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Checkout failed.");
      return;
    }
    const created = (await res.json()) as { id: number };
    setCreatedTicketId(created.id);
    setCart({});
  }

  return (
    <div className="page">
      <div className="ui-card ui-card--padded">
        <p className="page__intro page__intro--tight">
          Add multiple parts to your cart, then checkout to generate a pick ticket.
        </p>

        {error && <p className="banner banner--error">{error}</p>}
        {createdTicketId && (
          <p className="banner banner--success">
            Pick ticket <strong>#{createdTicketId}</strong> created.
          </p>
        )}

        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="stack-form">
            <section className="card">
              <h2 className="section-title">Build your cart {requesterName}</h2>
              {parts.length === 0 ? (
                <p className="banner banner--warning" style={{ marginTop: 0 }}>
                  No inventory rows found. Import inventory before creating a pick ticket.
                </p>
              ) : null}
              <div className="requester-build">
                <div className="stack-form stack-form--request">
                  <fieldset className="field request-type-field">
                    <legend className="field__label">Request type</legend>
                    <div className="request-type-options" role="radiogroup" aria-label="Request type">
                      {REQUEST_TYPE_OPTIONS.map(({ value, label }) => (
                        <label key={value} className="request-type-option">
                          <input
                            type="radio"
                            name="request-type"
                            className="request-type-option__input"
                            value={value}
                            checked={requestType === value}
                            onChange={() => setRequestType(value)}
                          />
                          <span className="request-type-option__label">{label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <SearchableSelect
                    label="Manufacturing Order ID"
                    value={selectedMoId}
                    options={moOptions}
                    placeholder="Select MO…"
                    searchPlaceholder="Search MO IDs…"
                    onChange={selectMo}
                  />

                  <SearchableSelect
                    label="Component Part ID (for selected MO)"
                    value={selectedComponentPartId}
                    options={componentPartOptions}
                    placeholder={selectedMoId ? "Select component part…" : "Select MO first"}
                    searchPlaceholder="Search Component Part IDs…"
                    disabled={!selectedMoId}
                    onChange={selectComponentPart}
                  />

                  <div className="request-choice-divider" role="separator" aria-label="or">
                    <span>OR</span>
                  </div>

                  <SearchableSelect
                    label="Part ID or Item Description"
                    value={selectedInventoryPartId}
                    options={partSearchOptions}
                    placeholder="Search part ID or description…"
                    searchPlaceholder="Type part ID or item description…"
                    onChange={selectInventoryPart}
                  />

                  <label className="field">
                    <span className="field__label">Quantity</span>
                    <input
                      className="field__input field__input--narrow"
                      type="number"
                      min={0}
                      step={1}
                      value={qtyDraft}
                      onChange={(e) => setQtyDraft(e.target.value)}
                    />
                  </label>

                  <button
                    type="button"
                    className="btn btn--primary btn--submit-wide"
                    onClick={addSelectedToCart}
                    disabled={!selectedPart || !selectedPartInShop}
                  >
                    Add to cart
                  </button>
                </div>
              </div>

              {selectedPart && (
                <p className="muted small" style={{ marginTop: "0.5rem" }}>
                  Selected: part <span className="mono">{selectedPart.part_id}</span> ·{" "}
                  {selectedPart.item_description || "No item description"} · MO{" "}
                  <span className="mono">{selectedPart.manufacturing_order_id}</span> · component{" "}
                  <span className="mono">{selectedPart.component_part_id}</span> · informational to-issue{" "}
                  <strong>{selectedPart.to_issue_quantity}</strong> · MO status{" "}
                  <span className="mono">{selectedPart.mo_status_code_description}</span>
                </p>
              )}
            </section>

            <section className="card">
              <h2 className="section-title">Cart</h2>
              {cartItems.length === 0 ? (
                <p className="muted">No items yet. Add from the table above.</p>
              ) : (
                <div className="cart-mo-groups">
                  {cartItemsByMo.map(({ manufacturing_order_id, rows }) => (
                    <div key={manufacturing_order_id} className="cart-mo-group">
                      <div className="cart-mo-group__head">
                        <span className="cart-mo-group__label">Manufacturing Order ID</span>
                        <span className="cart-mo-group__mo mono">{manufacturing_order_id}</span>
                      </div>
                      <div className="table-scroll">
                        <table className="data-table data-table--nested">
                          <thead>
                            <tr>
                              <th>Component Part</th>
                              <th>Part</th>
                              <th>Requested qty</th>
                              <th>To-issue info</th>
                              <th>On hand</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map(({ part, requested_quantity }) => (
                              <tr key={part.id}>
                                <td className="mono">{part.component_part_id}</td>
                                <td>
                                  <span className="mono">{part.part_id}</span>
                                  <br />
                                  <span className="muted small">{part.item_description || "No item description"}</span>
                                </td>
                                <td>
                                  <input
                                    className="field__input field__input--narrow"
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={String(requested_quantity)}
                                    onChange={(e) => setCartQty(part.id, e.target.value)}
                                    aria-label={`Requested quantity for ${part.component_part_id} (MO ${manufacturing_order_id})`}
                                  />
                                </td>
                                <td className="muted">{part.to_issue_quantity}</td>
                                <td>{part.on_hand_quantity}</td>
                                <td>
                                  <div className="row-actions">
                                    <button
                                      type="button"
                                      className="btn btn--small btn--danger-ghost"
                                      onClick={() => removeFromCart(part.id)}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={checkout} style={{ marginTop: "0.75rem" }}>
                <button
                  type="submit"
                  className="btn btn--primary btn--submit-wide"
                  disabled={busy || cartItems.length === 0}
                >
                  {busy ? "Checking out…" : "Checkout (generate pick ticket)"}
                </button>
              </form>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
