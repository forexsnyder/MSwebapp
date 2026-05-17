import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import type { AppNotification } from "../types";

export function NotificationBanner() {
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      return;
    }
    const res = await fetch(`/api/notifications?user=${encodeURIComponent(user)}&unread=1`);
    if (!res.ok) return;
    setItems((await res.json()) as AppNotification[]);
  }, [user]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(t);
  }, [load]);

  async function dismissAll() {
    if (!user || items.length === 0) return;
    await fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, ids: items.map((n) => n.id) }),
    });
    setItems([]);
  }

  if (!user || items.length === 0) return null;

  return (
    <div className="notification-banner" role="status">
      <div className="notification-banner__inner">
        <p className="notification-banner__title">Order updates</p>
        <ul className="notification-banner__list">
          {items.slice(0, 3).map((n) => (
            <li key={n.id}>{n.message}</li>
          ))}
        </ul>
        {items.length > 3 ? <p className="muted small">+{items.length - 3} more</p> : null}
      </div>
      <button type="button" className="btn btn--ghost btn--small" onClick={() => void dismissAll()}>
        Dismiss
      </button>
    </div>
  );
}
