import { useEffect, useState } from "react";

type PrintStatus = {
  enabled: boolean;
  printer: string | null;
  counts: Record<string, number>;
  attention: Array<{ pick_ticket_id: number; status: string }>;
  job: null | { status: string; printer: string; attempts: number; cups_request_id: string | null; error: string | null };
};
const descriptions: Record<string, string> = {
  queued: "Queued for automatic printing",
  preparing: "Preparing the pick ticket",
  submitting: "Sending to the print queue",
  submitted: "Sent to CUPS (paper output not confirmed)",
  failed: "Automatic printing failed - use Print ticket after checking the printer",
  uncertain: "Print outcome uncertain - check the printer queue before using Print ticket",
  skipped: "Automatic print skipped because this ticket is no longer open",
};

export function AutomaticPrintStatus({ ticketId }: { ticketId?: number }) {
  const [status, setStatus] = useState<PrintStatus | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    setStatus(null);
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const res = await fetch(`/api/printing/status${ticketId ? `?ticketId=${ticketId}` : ""}`, {
          signal: controller.signal, cache: "no-store",
        });
        if (!res.ok) throw new Error("status unavailable");
        const next = await res.json() as PrintStatus;
        if (!controller.signal.aborted) { setStatus(next); setError(false); }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally { pending = false; }
    }
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [ticketId]);
  if (!status && !error) return null;
  const attention = (status?.counts.failed ?? 0) + (status?.counts.uncertain ?? 0);
  return (
    <div className="notification-banner" role="status" aria-live="polite">
      <div className="notification-banner__inner">
        <p className="notification-banner__title">
          Automatic printing: {status ? status.enabled ? status.printer : "Off" : "Unavailable"}
        </p>
        {status && !status.enabled && <p className="small">Use Print ticket. New requests are not being queued for automatic printing.</p>}
        {status?.enabled && <p className="small">New requests print automatically. Keep the printer powered on. Paper output is not confirmed by this app.</p>}
        {attention > 0 && <p className="small"><strong>{attention} print job(s) need attention.</strong> Select the affected ticket to check its print status; check CUPS before reprinting.</p>}
        {status && attention > 0 && <p className="small">{status.attention.map(job => `TICKET-${String(job.pick_ticket_id).padStart(6, "0")} (${job.status})`).join(", ")}</p>}
        {status?.job && <p className="small"><strong>Selected ticket:</strong> {descriptions[status.job.status] ?? status.job.status}
          {status.job.cups_request_id ? ` - ${status.job.cups_request_id}` : ""}
          {status.job.status === "queued" && status.job.error ? ". Will retry automatically." : ""}
        </p>}
        {status && ticketId && !status.job && <p className="small">Selected ticket: no automatic print job. Use Print ticket.</p>}
        {error && <p className="small">Could not check print status. Retrying automatically.</p>}
      </div>
    </div>
  );
}
