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
"""
routes.py
────────────────────────────────────────────────────────────
All HTTP endpoints, registered as a Flask Blueprint.

Endpoints
─────────────────────────────────────────────────────────────
  GET  /api/health            health check
  GET  /api/refresh           force data reload
  GET  /api/sections          all 9 sections with stats
  GET  /api/sections/<id>     single section + paginated orders
  GET  /api/summary           global + per-section summary
  GET  /api/orders            list orders (filterable, paginated, sortable)
  GET  /api/orders/<id>       single order detail
  POST /api/voice             NLP voice query → response text + data
"""

from flask import Blueprint, request, jsonify
from config import CONFIG
from data_adapter import fetch_orders
from analytics import (
    apply_filters,
    paginate,
    global_summary,
    section_summary,
    handle_voice_query,
)

api = Blueprint("api", __name__, url_prefix="/api")


# ── GET /api/health ────────────────────────────────────────
@api.get("/health")
def health():
    return jsonify({
        "status":    "ok",
        "mode":      CONFIG["datasource"]["mode"],
        "timestamp": _now_iso(),
        "sections":  len(CONFIG["sections"]),
    })


# ── GET /api/refresh ───────────────────────────────────────
@api.get("/refresh")
def refresh():
    try:
        orders = fetch_orders(force_refresh=True)
        return jsonify({"refreshed": True, "count": len(orders), "at": _now_iso()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── GET /api/sections ──────────────────────────────────────
@api.get("/sections")
def sections():
    orders = fetch_orders()
    return jsonify({"sections": section_summary(orders)})


# ── GET /api/sections/<id> ─────────────────────────────────
@api.get("/sections/<int:section_id>")
def section_detail(section_id):
    sec = next((s for s in CONFIG["sections"] if s["id"] == section_id), None)
    if not sec:
        return jsonify({"error": f"Section {section_id} not found"}), 404

    orders     = fetch_orders()
    sec_orders = [o for o in orders if o["section_id"] == section_id]
    stats      = next(s for s in section_summary(orders) if s["section_id"] == section_id)

    page = int(request.args.get("page", 1))
    size = int(request.args.get("size", CONFIG["default_page_size"]))
    paged = paginate(sec_orders, page, size)

    return jsonify({"section": stats, **paged})


# ── GET /api/summary ───────────────────────────────────────
@api.get("/summary")
def summary():
    orders = fetch_orders()
    return jsonify(global_summary(orders))


# ── GET /api/orders ────────────────────────────────────────
# Query params:
#   section_id, status, application, plant, order_id,
#   date_from (ISO), date_to (ISO), sla_breached ("true"),
#   page, size, sort (field name), order ("asc"|"desc")
@api.get("/orders")
def orders_list():
    args = request.args

    filters = {
        "section_id":  args.get("section_id"),
        "status":      args.get("status"),
        "application": args.get("application"),
        "plant":       args.get("plant"),
        "order_id":    args.get("order_id"),
        "date_from":   args.get("date_from"),
        "date_to":     args.get("date_to"),
        "sla_breached":args.get("sla_breached"),
    }

    sort_col = args.get("sort",  "start_time")
    sort_dir = args.get("order", "desc")
    page     = int(args.get("page", 1))
    size     = int(args.get("size", CONFIG["default_page_size"]))

    all_orders = fetch_orders()
    filtered   = apply_filters(all_orders, filters)

    # Sort
    reverse = sort_dir == "desc"
    filtered.sort(
        key=lambda o: (o.get(sort_col) is None, o.get(sort_col) or ""),
        reverse=reverse,
    )

    paged = paginate(filtered, page, size)
    return jsonify({
        "filters": {k: v for k, v in filters.items() if v},
        **paged,
    })


# ── GET /api/orders/<id> ───────────────────────────────────
@api.get("/orders/<order_id>")
def order_detail(order_id):
    orders = fetch_orders()
    order  = next((o for o in orders if o["order_id"].upper() == order_id.upper()), None)
    if not order:
        return jsonify({"error": f"Order {order_id} not found"}), 404

    sec_stats = next(
        s for s in section_summary(orders) if s["section_id"] == order["section_id"]
    )
    return jsonify({"order": order, "section_stats": sec_stats})


# ── POST /api/voice ────────────────────────────────────────
@api.post("/voice")
def voice():
    body = request.get_json(silent=True) or {}
    query = body.get("query", "").strip()
    if not query:
        return jsonify({"error": "Body must include a non-empty `query` string"}), 400

    orders  = fetch_orders()
    result  = handle_voice_query(query, orders)
    summary = global_summary(orders)

    return jsonify({
        "query":          query,
        "response_text":  result["response_text"],
        "filter_applied": result["filter_applied"],
        "order_count":    len(result["orders"]),
        "orders":         result["orders"],
        "summary": {
            "total":        summary["total"],
            "on_time":      summary["on_time"],
            "delayed":      summary["delayed"],
            "failed":       summary["failed"],
            "pending":      summary["pending"],
            "on_time_rate": summary["on_time_rate"],
            "sla_breached": summary["sla_breached"],
        },
    })


# ── Helper ─────────────────────────────────────────────────
def _now_iso():
    from datetime import datetime, timezone
    return datetime.now(tz=timezone.utc).isoformat()
