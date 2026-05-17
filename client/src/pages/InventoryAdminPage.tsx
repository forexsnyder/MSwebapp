import { useCallback, useEffect, useState } from "react";
import type { Part } from "../types";

export function InventoryAdminPage() {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/parts");
    if (!res.ok) {
      setError("Could not load parts.");
      return;
    }
    setParts(await res.json());
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

  return (
    <div className="page page--inventory">
      <p className="page__intro">Seeded inventory parts (dummy data starts with <code>test_</code>).</p>

      {error && <p className="banner banner--error">{error}</p>}

      <section className="card admin-table-section">
        <h2 className="section-title">Inventory</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : parts.length === 0 ? (
          <p className="muted">No rows found.</p>
        ) : (
          <>
            <div className="inventory-rows">
              {parts.map((p) => (
                <div key={p.id} className="inventory-row-card">
                  <div className="inventory-row-card__head">
                    <span className="muted small">
                      DB id <span className="mono">{p.id}</span>
                    </span>
                    <span className="mono small">{p.manufacturing_order_id}</span>
                  </div>

                  <div className="inventory-row-card__grid">
                    <div className="inventory-row-card__kv">
                      <strong>Part</strong>
                      <span className="mono">
                        {p.part_id} rev {p.part_revision_id}
                      </span>
                    </div>
                    <div className="inventory-row-card__kv">
                      <strong>Component</strong>
                      <span className="mono">
                        {p.component_part_id} rev {p.component_part_revision_id}
                      </span>
                    </div>
                    <div className="inventory-row-card__kv">
                      <strong>On hand</strong>
                      <span>{p.on_hand_quantity}</span>
                    </div>
                    <div className="inventory-row-card__kv">
                      <strong>To-issue</strong>
                      <span>{p.to_issue_quantity}</span>
                    </div>
                    <div className="inventory-row-card__kv">
                      <strong>Inv code</strong>
                      <span className="mono small">{p.inventory_abbreviation_code}</span>
                    </div>
                    <div className="inventory-row-card__kv">
                      <strong>Inv location</strong>
                      <span className="mono small">{p.default_inventory_location_id}</span>
                    </div>
                    <div className="inventory-row-card__kv">
                      <strong>Component order</strong>
                      <span className="mono small">{p.component_order_id}</span>
                    </div>
                    <div className="inventory-row-card__kv">
                      <strong>MO status</strong>
                      <span className="mono small">{p.mo_status_code_description}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
