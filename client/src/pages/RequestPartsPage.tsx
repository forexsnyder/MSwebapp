import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Order, Part } from "../types";
import { SearchableSelect } from "../components/SearchableSelect";
import { useAuth } from "../auth/AuthContext";

const DUMMY_REQUESTER_NAME = "Test_Steve";

type RequestType = "issue" | "scrap" | "return";

type CartEntry = {
  inventory_part_id: number;
  manufacturing_order_id: string;
  component_part_id: string;
  requested_quantity: number;
};

const REQUEST_TYPE_OPTIONS: { value: RequestType; label: string }[] = [
  { value: "issue", label: "Issue" },
  { value: "scrap", label: "Scrap" },
  { value: "return", label: "Return" },
];

function catalogPartKey(part: Pick<Part, "part_id" | "item_description">) {
  const partId = part.part_id.trim();
  const description = part.item_description?.trim() || "No item description";
  return `${partId.toLocaleLowerCase()}\u001f${description.toLocaleLowerCase()}`;
}

export function RequestPartsPage() {
  const { user } = useAuth();
  const requesterName = user?.trim() || DUMMY_REQUESTER_NAME;
  const [parts, setParts] = useState<Part[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cart, setCart] = useState<Record<string, CartEntry>>({});
  const [createdTicketId, setCreatedTicketId] = useState<number | null>(null);
  const [requestType, setRequestType] = useState<RequestType>("issue");
  const [selectedInventoryPartId, setSelectedInventoryPartId] = useState("");
  const [selectedMoId, setSelectedMoId] = useState("");
  const [selectedComponentPartId, setSelectedComponentPartId] = useState("");
  const [qtyDraft, setQtyDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const [inventoryRes, ordersRes] = await Promise.all([
        fetch("/api/inventory-catalog"),
        fetch("/api/manufacturing-orders"),
      ]);
      if (!inventoryRes.ok || !ordersRes.ok) {
        if (!cancelled) setError("Could not load Inventory and MO data.");
        return;
      }
      const [inventoryData, orderData] = await Promise.all([
        inventoryRes.json() as Promise<Part[]>,
        ordersRes.json() as Promise<Order[]>,
      ]);
      if (!cancelled) {
        setParts(inventoryData);
        setOrders(orderData);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cartItems = useMemo(() => {
    const byId = new Map(parts.map((p) => [p.id, p] as const));
    return Object.entries(cart)
      .map(([cartKey, entry]) => {
        const part = byId.get(entry.inventory_part_id);
        if (!part) return null;
        return { cartKey, part, ...entry };
      })
      .filter(Boolean) as Array<{ cartKey: string; part: Part } & CartEntry>;
  }, [cart, parts]);

  const cartItemsByMo = useMemo(() => {
    const order: string[] = [];
    const groups = new Map<string, Array<{ cartKey: string; part: Part } & CartEntry>>();
    for (const row of cartItems) {
      const mo = row.manufacturing_order_id;
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

  const selectedSearchPart = useMemo(() => {
    if (!selectedInventoryPartId) return null;
    return parts.find((p) => String(p.id) === selectedInventoryPartId) ?? null;
  }, [parts, selectedInventoryPartId]);

  const moOptions = useMemo(() => {
    return Array.from(
      new Set(orders.map((order) => order.manufacturing_order_id).filter(Boolean)),
    )
      .sort((a, b) => a.localeCompare(b))
      .map((mo) => ({ value: mo, label: mo }));
  }, [orders]);

  const partSearchOptions = useMemo(() => {
    const uniqueParts = new Map<string, Part>();

    for (const part of parts) {
      const key = catalogPartKey(part);
      if (!uniqueParts.has(key)) uniqueParts.set(key, part);
    }

    return Array.from(uniqueParts.values())
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

  const ordersForMo = useMemo(() => {
    if (!selectedMoId) return [];
    return orders.filter((order) => order.manufacturing_order_id === selectedMoId);
  }, [orders, selectedMoId]);

  const componentPartOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const order of ordersForMo) {
      if (!order.component_part_id) continue;
      const description =
        order.component_part_id_item_description?.trim() ||
        (order.item_description ? `${order.component_part_id} - ${order.item_description}` : order.component_part_id);
      if (!byId.has(order.component_part_id) || description.length > (byId.get(order.component_part_id)?.length ?? 0)) {
        byId.set(order.component_part_id, description);
      }
    }
    return Array.from(byId.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, description]) => ({
        value: id,
        label: description,
        searchText: `${id} ${description}`,
      }));
  }, [ordersForMo]);

  const selectedPart = selectedSearchPart;
  const selectedOrder = useMemo(() => {
    if (!selectedMoId) return null;
    return (
      ordersForMo.find((order) => order.component_part_id === selectedComponentPartId) ??
      ordersForMo.find((order) => order.mo_status_code_description.includes("In Shop")) ??
      ordersForMo[0] ??
      null
    );
  }, [ordersForMo, selectedComponentPartId, selectedMoId]);

  const selectedMoInShop = Boolean(
    selectedOrder?.mo_status_code_description.includes("In Shop"),
  );

  function selectInventoryPart(value: string) {
    setSelectedInventoryPartId(value);
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
    if (!selectedMoId) {
      setError("Select a Manufacturing Order ID.");
      return;
    }
    if (!selectedPart) {
      setError("Select a Part ID or Item Description from Inventory.");
      return;
    }
    if (!selectedMoInShop) {
      setError('This MO cannot be used unless its Status Code Description contains "In Shop".');
      return;
    }
    const q = Number(qtyDraft);
    if (!Number.isInteger(q) || q < 0) {
      setError("Quantity must be a whole number ≥ 0.");
      return;
    }
    const cartKey = `${selectedMoId}\u001f${selectedComponentPartId}\u001f${selectedPart.id}`;
    setCart((prev) => ({
      ...prev,
      [cartKey]: {
        inventory_part_id: selectedPart.id,
        manufacturing_order_id: selectedMoId,
        component_part_id: selectedComponentPartId,
        requested_quantity: q,
      },
    }));
    setQtyDraft("");
    setSelectedInventoryPartId("");
  }

  function removeFromCart(cartKey: string) {
    setCart((prev) => {
      const next = { ...prev };
      delete next[cartKey];
      return next;
    });
  }

  function setCartQty(cartKey: string, raw: string) {
    const q = Number(raw);
    if (!Number.isInteger(q) || q < 0) return;
    setCart((prev) => ({
      ...prev,
      [cartKey]: { ...prev[cartKey], requested_quantity: q },
    }));
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
          manufacturing_order_id: ci.manufacturing_order_id,
          component_part_id: ci.component_part_id,
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
                    searchPlaceholder="Enter or search MO IDs…"
                    onChange={selectMo}
                  />

                  <SearchableSelect
                    label="Component Part ID (optional, from MO data)"
                    value={selectedComponentPartId}
                    options={componentPartOptions}
                    placeholder={selectedMoId ? "Select component part…" : "Select MO first"}
                    searchPlaceholder="Search Component Part IDs…"
                    disabled={!selectedMoId}
                    onChange={selectComponentPart}
                  />

                  <div className="request-choice-divider" role="separator" aria-label="Inventory selection">
                    <span>INVENTORY</span>
                  </div>

                  <SearchableSelect
                    label="Part ID or Item Description"
                    value={selectedInventoryPartId}
                    options={partSearchOptions}
                    placeholder="Enter part ID or description…"
                    searchPlaceholder="Enter any part of the ID or description…"
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
                    disabled={!selectedMoId || !selectedPart || !selectedMoInShop}
                  >
                    Add to cart
                  </button>
                </div>
              </div>

              {selectedPart && selectedMoId && (
                <p className="muted small" style={{ marginTop: "0.5rem" }}>
                  Selected: part <span className="mono">{selectedPart.part_id}</span> ·{" "}
                  {selectedPart.item_description || "No item description"} · MO{" "}
                  <span className="mono">{selectedMoId}</span>
                  {selectedComponentPartId ? (
                    <> · component <span className="mono">{selectedComponentPartId}</span></>
                  ) : null}
                  {selectedOrder ? (
                    <>
                      {" "}· informational to-issue <strong>{selectedOrder.to_issue_quantity}</strong> · MO status{" "}
                      <span className="mono">{selectedOrder.mo_status_code_description}</span>
                    </>
                  ) : null}
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
                            {rows.map(({ cartKey, part, component_part_id, requested_quantity }) => (
                              <tr key={cartKey}>
                                <td className="mono">{component_part_id || "—"}</td>
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
                                    onChange={(e) => setCartQty(cartKey, e.target.value)}
                                    aria-label={`Requested quantity for ${part.part_id} (MO ${manufacturing_order_id})`}
                                  />
                                </td>
                                <td className="muted">
                                  {orders.find(
                                    (order) =>
                                      order.manufacturing_order_id === manufacturing_order_id &&
                                      (!component_part_id || order.component_part_id === component_part_id),
                                  )?.to_issue_quantity ?? "—"}
                                </td>
                                <td>{part.on_hand_quantity}</td>
                                <td>
                                  <div className="row-actions">
                                    <button
                                      type="button"
                                      className="btn btn--small btn--danger-ghost"
                                      onClick={() => removeFromCart(cartKey)}
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
