/**
 * routes.js
 * ──────────────────────────────────────────────────────────
 * All HTTP endpoints.  Mount with:  app.use("/api", routes)
 *
 * Endpoints
 * ─────────────────────────────────────────────────────────
 *  GET  /api/orders            — list orders (filterable, paginated)
 *  GET  /api/orders/:id        — single order detail
 *  GET  /api/summary           — global + per-section summary
 *  GET  /api/sections          — list of all 9 sections
 *  GET  /api/sections/:id      — single section stats
 *  POST /api/voice             — voice/NLP query → response text + data
 *  GET  /api/health            — health check
 *  GET  /api/refresh           — force data refresh
 */

const express  = require("express");
const router   = express.Router();
const { fetchOrders }  = require("./dataAdapter");
const {
  applyFilters,
  paginate,
  globalSummary,
  sectionSummary,
  handleVoiceQuery,
} = require("./analytics");
const CONFIG = require("./config");

// ── Middleware: load orders into req ───────────────────────
async function loadOrders(req, _res, next) {
  try {
    req.allOrders = await fetchOrders();
    next();
  } catch (err) {
    next(err);
  }
}

// ── GET /api/health ────────────────────────────────────────
router.get("/health", (_req, res) => {
  res.json({
    status:    "ok",
    mode:      CONFIG.datasource.mode,
    timestamp: new Date().toISOString(),
    sections:  CONFIG.sections.length,
  });
});

// ── GET /api/refresh ───────────────────────────────────────
router.get("/refresh", async (_req, res, next) => {
  try {
    const orders = await fetchOrders(true);
    res.json({ refreshed: true, count: orders.length, at: new Date().toISOString() });
  } catch (err) { next(err); }
});

// ── GET /api/sections ──────────────────────────────────────
router.get("/sections", loadOrders, (req, res) => {
  const stats = sectionSummary(req.allOrders);
  res.json({ sections: stats });
});

// ── GET /api/sections/:id ──────────────────────────────────
router.get("/sections/:id", loadOrders, (req, res) => {
  const id = Number(req.params.id);
  const sec = CONFIG.sections.find(s => s.id === id);
  if (!sec) return res.status(404).json({ error: `Section ${id} not found` });

  const secOrders = req.allOrders.filter(o => o.sectionId === id);
  const [stats]   = sectionSummary(req.allOrders).filter(s => s.sectionId === id);

  const { page = 1, size = CONFIG.defaultPageSize } = req.query;
  const paged = paginate(secOrders, Number(page), Number(size));

  res.json({ section: stats, ...paged });
});

// ── GET /api/summary ───────────────────────────────────────
router.get("/summary", loadOrders, (req, res) => {
  res.json(globalSummary(req.allOrders));
});

// ── GET /api/orders ────────────────────────────────────────
// Query params:
//   sectionId, status, application, plant, orderId,
//   dateFrom (ISO), dateTo (ISO), slaBreached ("true"),
//   page, size, sort ("startTime"|"runtimeMin"|"orderId"), order ("asc"|"desc")
router.get("/orders", loadOrders, (req, res) => {
  const {
    sectionId, status, application, plant, orderId,
    dateFrom, dateTo, slaBreached,
    page = 1, size = CONFIG.defaultPageSize,
    sort = "startTime", order: sortOrder = "desc",
  } = req.query;

  let filtered = applyFilters(req.allOrders, {
    sectionId, status, application, plant, orderId,
    dateFrom, dateTo, slaBreached,
  });

  // Sort
  filtered.sort((a, b) => {
    const va = a[sort] instanceof Date ? a[sort].getTime() : a[sort];
    const vb = b[sort] instanceof Date ? b[sort].getTime() : b[sort];
    if (va == null) return 1;
    if (vb == null) return -1;
    return sortOrder === "asc" ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });

  const paged = paginate(filtered, Number(page), Number(size));
  res.json({
    filters: { sectionId, status, application, plant, orderId, dateFrom, dateTo, slaBreached },
    ...paged,
  });
});

// ── GET /api/orders/:id ────────────────────────────────────
router.get("/orders/:id", loadOrders, (req, res) => {
  const order = req.allOrders.find(
    o => o.orderId.toLowerCase() === req.params.id.toLowerCase()
  );
  if (!order) return res.status(404).json({ error: `Order ${req.params.id} not found` });

  // Include section SLA context
  const secStats = sectionSummary(req.allOrders).find(s => s.sectionId === order.sectionId);
  res.json({ order, sectionStats: secStats });
});

// ── POST /api/voice ────────────────────────────────────────
// Body: { query: string }
// Returns: { responseText, orders[], filterApplied, summary }
router.post("/voice", loadOrders, express.json(), (req, res) => {
  const { query } = req.body || {};
  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Body must include a non-empty `query` string" });
  }

  const result = handleVoiceQuery(query.trim(), req.allOrders);
  const summary = globalSummary(req.allOrders);

  res.json({
    query,
    responseText: result.responseText,
    filterApplied: result.filterApplied,
    orderCount: result.orders.length,
    orders: result.orders,
    summary: {
      total:       summary.total,
      onTime:      summary.onTime,
      delayed:     summary.delayed,
      failed:      summary.failed,
      pending:     summary.pending,
      onTimeRate:  summary.onTimeRate,
      slaBreached: summary.slaBreached,
    },
  });
});

// ── Error handler ──────────────────────────────────────────
router.use((err, _req, res, _next) => {
  console.error("[Routes] Error:", err.message);
  res.status(500).json({ error: err.message });
});

module.exports = router;
