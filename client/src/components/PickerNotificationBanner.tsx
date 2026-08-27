import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import type { AppNotification } from "../types";

export function PickerNotificationBanner({ onRefresh }: { onRefresh: () => void }) {
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const revision = useRef(0);

  useEffect(() => {
    setItems([]);
    setError(null);
    setDismissing(false);
    if (!user) return;
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      const requestRevision = revision.current;
      try {
        const res = await fetch(`/api/picker-notifications?user=${encodeURIComponent(user)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Could not check for new orders. Retrying automatically.");
        const next = (await res.json()) as AppNotification[];
        if (!controller.signal.aborted && requestRevision === revision.current) {
          setItems(next);
          setError(null);
        }
      } catch {
        if (!controller.signal.aborted && requestRevision === revision.current) {
          setError("Could not check for new orders. Retrying automatically.");
        }
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) refresh.current();
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      controller.abort();
      revision.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [user]);

  async function dismissAll() {
    if (!user || dismissing || items.length === 0) return;
    const ids = items.map((item) => item.id);
    const requestRevision = ++revision.current;
    setDismissing(true);
    try {
      const res = await fetch("/api/picker-notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, ids }),
      });
      if (!res.ok) throw new Error("dismiss failed");
      if (requestRevision === revision.current) {
        setItems((current) => current.filter((item) => !ids.includes(item.id)));
        setError(null);
      }
    } catch {
      if (requestRevision === revision.current) {
        setError("Could not dismiss new-order notifications. Please try again.");
      }
    } finally {
      if (requestRevision === revision.current) {
        revision.current += 1;
        setDismissing(false);
      }
    }
  }

  if (!user || (items.length === 0 && !error)) return null;

  return (
    <div className="notification-banner" role="status" aria-live="polite">
      <div className="notification-banner__inner">
        <p className="notification-banner__title">New orders to pick{items.length ? ` (${items.length})` : ""}</p>
        {items.length > 0 && (
          <ul className="notification-banner__list">
            {items.slice(0, 3).map((item) => <li key={item.id}>{item.message}</li>)}
          </ul>
        )}
        {items.length > 3 && <p className="muted small">+{items.length - 3} more</p>}
        {error && <p className="small">{error}</p>}
      </div>
      {items.length > 0 && (
        <button type="button" className="btn btn--ghost btn--small" disabled={dismissing} onClick={() => void dismissAll()}>
          {dismissing ? "Dismissing…" : "Dismiss"}
        </button>
      )}
    </div>
  );
}
