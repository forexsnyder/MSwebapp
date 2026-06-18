import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  cancelPickTicket,
  closePickTicket,
  reopenPickTicket,
  createPickTicket,
  clearAuditLog,
  clearPickQueue,
  exportInventoryCsv,
  getPickTicket,
  importInventoryCsv,
  importInventoryWorkbook,
  listAuditLog,
  listPickTickets,
  listUserPickTicketHistory,
  listNotifications,
  markNotificationsRead,
  listParts,
  resetDatabase,
  resetInventory,
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Vite production output — same machine as API, so /api and the SPA share one origin. */
const clientDist = path.resolve(__dirname, "../client/dist");
const hasClientBuild = fs.existsSync(path.join(clientDist, "index.html"));

const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !hasClientBuild) {
  console.error(
    "[fatal] NODE_ENV=production but client/dist is missing. Run `npm run build` from the repo root, then start again.",
  );
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT ?? 3001;

app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}

// Internal/LAN app defaults:
// - In production we usually serve UI + API from the same origin, so CORS is not needed.
// - If you *do* need cross-origin access (e.g. UI served elsewhere), set CORS_ORIGIN.
const corsOrigin = process.env.CORS_ORIGIN ? String(process.env.CORS_ORIGIN) : "";
if (!isProduction) {
  app.use(cors({ origin: true }));
} else if (corsOrigin.trim()) {
  const allow = corsOrigin
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(cors({ origin: allow }));
}

app.use(express.json({ limit: process.env.JSON_LIMIT ?? "25mb" }));

const adminToken = process.env.ADMIN_TOKEN ? String(process.env.ADMIN_TOKEN) : "";
app.use("/api/admin", (req, res, next) => {
  if (!adminToken.trim()) {
    next();
    return;
  }
  const provided = req.get("x-admin-token") ?? "";
  if (provided !== adminToken) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV ?? "development",
    hasClientBuild,
    uptime_s: Math.round(process.uptime()),
  });
});

app.get("/api/parts", (_req, res) => {
  res.json(listParts());
});

app.get("/api/pick-tickets", (req, res) => {
  const status = String(req.query.status ?? "open").trim().toLowerCase();
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const includeCancelled =
    req.query.includeCancelled === "1" || req.query.includeCancelled === "true";
  res.json(
    listPickTickets({
      status: status === "closed" ? "closed" : "open",
      q,
      includeCancelled,
    }),
  );
});

app.get("/api/notifications", (req, res) => {
  const user = String(req.query.user ?? "").trim();
  if (!user) {
    res.status(400).json({ error: "user is required" });
    return;
  }
  try {
    const unreadOnly = req.query.unread === "1" || req.query.unread === "true";
    res.json(listNotifications(user, { unreadOnly }));
  } catch (e) {
    res.status(400).json({ error: e.message || "invalid notifications request" });
  }
});

app.post("/api/notifications/mark-read", (req, res) => {
  const user = String(req.body?.user ?? "").trim();
  if (!user) {
    res.status(400).json({ error: "user is required" });
    return;
  }
  try {
    res.json(markNotificationsRead(user, req.body?.ids ?? []));
  } catch (e) {
    res.status(400).json({ error: e.message || "mark read failed" });
  }
});

app.get("/api/history", (req, res) => {
  const user = String(req.query.user ?? "").trim();
  if (!user) {
    res.status(400).json({ error: "user is required" });
    return;
  }
  try {
    res.json(listUserPickTicketHistory(user));
  } catch (e) {
    res.status(400).json({ error: e.message || "invalid history request" });
  }
});

app.get("/api/pick-tickets/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const row = getPickTicket(id);
  if (!row) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(row);
});

app.post("/api/pick-tickets", (req, res) => {
  try {
    const row = createPickTicket(req.body ?? {});
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: e.message || "invalid pick ticket" });
  }
});

app.post("/api/pick-tickets/:id/cancel", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  try {
    const row = cancelPickTicket(id, { cancelled_by: req.body?.cancelled_by });
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(row);
  } catch (e) {
    res.status(400).json({ error: e.message || "cancel failed" });
  }
});

app.post("/api/pick-tickets/:id/reopen", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  try {
    const row = reopenPickTicket(id, { reopened_by: req.body?.reopened_by });
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(row);
  } catch (e) {
    res.status(400).json({ error: e.message || "reopen failed" });
  }
});

app.post("/api/pick-tickets/:id/close", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  try {
    const row = closePickTicket(id, {
      picker_name: req.body?.picker_name,
      line_lots: req.body?.line_lots,
    });
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(row);
  } catch (e) {
    res.status(400).json({ error: e.message || "close failed" });
  }
});

app.get("/api/audit-log", (req, res) => {
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  res.json(listAuditLog({ limit }));
});

app.post("/api/admin/reset-inventory", (req, res) => {
  try {
    const actor = req.body?.actor ?? "unknown";
    res.json({ ok: true, ...resetInventory({ actor }) });
  } catch (e) {
    res.status(400).json({ error: e.message || "reset failed" });
  }
});

app.post("/api/admin/reset-database", (_req, res) => {
  try {
    res.json({ ok: true, ...resetDatabase() });
  } catch (e) {
    res.status(400).json({ error: e.message || "reset failed" });
  }
});

app.post("/api/admin/clear-pick-queue", (req, res) => {
  try {
    const actor = req.body?.actor ?? "unknown";
    res.json({ ok: true, ...clearPickQueue({ actor }) });
  } catch (e) {
    res.status(400).json({ error: e.message || "clear failed" });
  }
});

app.post("/api/admin/clear-audit-log", (_req, res) => {
  try {
    res.json({ ok: true, ...clearAuditLog() });
  } catch (e) {
    res.status(400).json({ error: e.message || "clear failed" });
  }
});

app.post("/api/inventory/import", async (req, res) => {
  try {
    const actor = req.body?.actor ?? req.body?.requester_name ?? "unknown";
    const workbookBase64 = req.body?.workbookBase64;
    const result = workbookBase64
      ? await importInventoryWorkbook({ actor, workbookBase64 })
      : importInventoryCsv({ actor, csvText: req.body?.csv });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message || "import failed" });
  }
});

app.get("/api/inventory/export.csv", (_req, res) => {
  const csv = exportInventoryCsv();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="on_site_inventory.csv"`);
  res.send("\uFEFF" + csv);
});

if (hasClientBuild) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}

app.listen(PORT, "0.0.0.0", () => {
  if (hasClientBuild) {
    console.log(
      `http://0.0.0.0:${PORT} — API + web UI (from client/dist); on this machine: http://localhost:${PORT}; other PCs: http://<this-vm-lan-ip>:${PORT}`,
    );
  } else {
    console.log(
      `http://0.0.0.0:${PORT} — API only; build client for UI: npm run build -w client — then other PCs: http://<this-vm-lan-ip>:${PORT}`,
    );
  }
});
