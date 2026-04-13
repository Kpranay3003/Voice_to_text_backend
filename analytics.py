"""
analytics.py
────────────────────────────────────────────────────────────
All business logic: filtering, pagination, aggregation,
section summaries, and the voice NLP query handler.
"""

import re
from config import CONFIG


# ── Filters ────────────────────────────────────────────────

def apply_filters(orders: list[dict], filters: dict) -> list[dict]:
    result = orders[:]

    if filters.get("section_id"):
        sid = int(filters["section_id"])
        result = [o for o in result if o["section_id"] == sid]

    if filters.get("status"):
        st = filters["status"].lower()
        result = [o for o in result if o["status"].lower() == st]

    if filters.get("application"):
        app = filters["application"].lower()
        result = [o for o in result if app in o["application"].lower()]

    if filters.get("plant"):
        result = [o for o in result if o["plant"] == filters["plant"]]

    if filters.get("order_id"):
        oid = filters["order_id"].lower()
        result = [o for o in result if oid in o["order_id"].lower()]

    if filters.get("date_from"):
        result = [o for o in result if o["start_time"] and o["start_time"] >= filters["date_from"]]

    if filters.get("date_to"):
        result = [o for o in result if o["start_time"] and o["start_time"] <= filters["date_to"]]

    if filters.get("sla_breached") == "true":
        result = [o for o in result if o["sla_status"] == "Breached"]

    return result


# ── Pagination ─────────────────────────────────────────────

def paginate(items: list, page: int = 1, size: int = None) -> dict:
    size  = min(size or CONFIG["default_page_size"], CONFIG["max_page_size"])
    total = len(items)
    start = (page - 1) * size
    return {
        "items": items[start: start + size],
        "pagination": {
            "page":  page,
            "size":  size,
            "total": total,
            "pages": max(1, -(-total // size)),   # ceiling division
        },
    }


# ── Section summary ────────────────────────────────────────

def section_summary(orders: list[dict]) -> list[dict]:
    summaries = []
    for sec in CONFIG["sections"]:
        group   = [o for o in orders if o["section_id"] == sec["id"]]
        on_time = sum(1 for o in group if o["status"] == "On Time")
        delayed = sum(1 for o in group if o["status"] == "Delayed")
        failed  = sum(1 for o in group if o["status"] == "Failed")
        pending = sum(1 for o in group if o["status"] == "Pending")
        breached= sum(1 for o in group if o["sla_status"] == "Breached")
        runtimes= [o["runtime_min"] for o in group if o["runtime_min"] > 0]
        avg_rt  = round(sum(runtimes) / len(runtimes)) if runtimes else 0
        max_rt  = max(runtimes) if runtimes else 0
        total   = len(group)
        sla_min = CONFIG["sla"].get(sec["id"], 60)

        summaries.append({
            "section_id":     sec["id"],
            "section_name":   sec["name"],
            "section_short":  sec["short"],
            "sla_minutes":    sla_min,
            "total":          total,
            "on_time":        on_time,
            "delayed":        delayed,
            "failed":         failed,
            "pending":        pending,
            "success_count":  on_time,
            "failed_count":   failed,
            "sla_breached":   breached,
            "on_time_rate":   round(on_time / total * 100, 1) if total else 0.0,
            "avg_runtime_min":avg_rt,
            "max_runtime_min":max_rt,
            "avg_runtime_str":_fmt_min(avg_rt),
            "max_runtime_str":_fmt_min(max_rt),
        })
    return summaries


# ── Global summary ─────────────────────────────────────────

def global_summary(orders: list[dict]) -> dict:
    from datetime import datetime, timezone
    total    = len(orders)
    on_time  = sum(1 for o in orders if o["status"] == "On Time")
    delayed  = sum(1 for o in orders if o["status"] == "Delayed")
    failed   = sum(1 for o in orders if o["status"] == "Failed")
    pending  = sum(1 for o in orders if o["status"] == "Pending")
    breached = sum(1 for o in orders if o["sla_status"] == "Breached")
    runtimes = [o["runtime_min"] for o in orders if o["runtime_min"] > 0]
    avg_rt   = round(sum(runtimes) / len(runtimes)) if runtimes else 0

    return {
        "total":           total,
        "on_time":         on_time,
        "delayed":         delayed,
        "failed":          failed,
        "pending":         pending,
        "success_count":   on_time,
        "failed_count":    failed,
        "sla_breached":    breached,
        "on_time_rate":    round(on_time / total * 100, 1) if total else 0.0,
        "avg_runtime_str": _fmt_min(avg_rt),
        "sections":        section_summary(orders),
        "generated_at":    datetime.now(tz=timezone.utc).isoformat(),
    }


# ── Voice / NLP query handler ──────────────────────────────

def handle_voice_query(query: str, all_orders: list[dict]) -> dict:
    q = query.lower().strip()
    orders: list[dict] = []
    response_text = ""
    filter_applied: dict = {}

    summary = global_summary(all_orders)

    # ── Full summary
    if re.search(r"\b(summary|overview|all section|total|full report)\b", q):
        response_text = (
            f"Overall summary: {summary['total']} orders tracked across 9 SAP sections. "
            f"{summary['on_time']} are on time at {summary['on_time_rate']}% on-time rate. "
            f"{summary['delayed']} delayed, {summary['failed']} failed, {summary['pending']} pending. "
            f"{summary['sla_breached']} orders have breached their SLA thresholds."
        )
        orders = all_orders

    # ── Failed orders
    elif re.search(r"\b(fail|error|abort|broken)\b", q):
        orders = [o for o in all_orders if o["is_failed"]]
        filter_applied = {"status": "Failed"}
        response_text = _build_status_response("Failed", orders, summary)

    # ── Delayed orders
    elif re.search(r"\b(delay|late|overdue|behind)\b", q):
        orders = [o for o in all_orders if o["status"] == "Delayed"]
        filter_applied = {"status": "Delayed"}
        response_text = _build_status_response("Delayed", orders, summary)

    # ── On-time orders
    elif re.search(r"\b(on.?time|success|complet|done)\b", q):
        orders = [o for o in all_orders if o["is_success"]]
        filter_applied = {"status": "On Time"}
        response_text = _build_status_response("On Time", orders, summary)

    # ── Pending orders
    elif re.search(r"\b(pending|in.?progress|running|active)\b", q):
        orders = [o for o in all_orders if o["status"] == "Pending"]
        filter_applied = {"status": "Pending"}
        response_text = _build_status_response("Pending", orders, summary)

    # ── SLA breached
    elif re.search(r"\bsla\b", q):
        orders = [o for o in all_orders if o["sla_status"] == "Breached"]
        filter_applied = {"sla_breached": "true"}
        response_text = (
            f"{len(orders)} orders have breached their SLA thresholds. "
            + _section_breakdown(orders)
        )

    # ── Specific order ID
    elif re.search(r"ord-?\d+", q, re.IGNORECASE):
        m = re.search(r"ord-?(\d+)", q, re.IGNORECASE)
        search_id = f"ORD-{m.group(1)}"
        orders = [o for o in all_orders if o["order_id"].upper() == search_id.upper()]
        filter_applied = {"order_id": search_id}
        if orders:
            o = orders[0]
            response_text = (
                f"Order {o['order_id']}: Section {o['section_id']} — {o['section_short']}. "
                f"Status: {o['status']}. "
                f"Started: {o['start_time'] or '–'}. "
                + (f"Ended: {o['end_time']}. " if o["end_time"] else "Still running. ")
                + f"Runtime: {o['runtime_str']}. SLA: {o['sla_status']}. "
                f"Application: {o['application']}. Created by: {o['created_by']}."
            )
        else:
            response_text = f"No order found matching {search_id}."

    # ── Section-specific
    else:
        sec = _match_section(q)
        if sec:
            orders = [o for o in all_orders if o["section_id"] == sec["id"]]
            filter_applied = {"section_id": sec["id"]}
            ss = next(s for s in summary["sections"] if s["section_id"] == sec["id"])
            response_text = (
                f"Section {sec['id']} — {sec['name']}: {ss['total']} orders. "
                f"{ss['on_time']} on time ({ss['on_time_rate']}%), "
                f"{ss['delayed']} delayed, {ss['failed']} failed, {ss['pending']} pending. "
                f"SLA threshold: {ss['sla_minutes']} minutes. "
                f"Average runtime: {ss['avg_runtime_str']}. "
                f"{ss['sla_breached']} orders breached SLA."
            )

    # ── Critical / urgent (can overlay above results)
    if re.search(r"\b(critical|urgent|worst|most delay)\b", q):
        ranked = sorted(
            [s for s in summary["sections"] if s["delayed"] + s["failed"] > 0],
            key=lambda s: s["delayed"] + s["failed"],
            reverse=True,
        )
        orders = [o for o in all_orders if o["status"] in ("Delayed", "Failed")]
        filter_applied = {"status": "Delayed/Failed"}
        top3 = ", ".join(
            f"{s['section_short']} with {s['delayed'] + s['failed']} issues"
            for s in ranked[:3]
        )
        response_text = (
            f"Critical status: {len(orders)} orders need attention. "
            f"Most impacted sections: {top3}."
        )

    # ── Fallback
    if not response_text:
        response_text = (
            f"I didn't catch a specific query. You have {summary['total']} orders: "
            f"{summary['on_time']} on time, {summary['delayed']} delayed, "
            f"{summary['failed']} failed, {summary['pending']} pending. "
            "Try asking about a specific section, order ID, or status."
        )
        orders = all_orders

    return {
        "response_text":  response_text,
        "orders":         orders[: CONFIG["max_page_size"]],
        "filter_applied": filter_applied,
    }


# ── Private helpers ────────────────────────────────────────

def _match_section(q: str) -> dict | None:
    # By number
    m = re.search(r"section\s*(\d)", q)
    if m:
        sid = int(m.group(1))
        return next((s for s in CONFIG["sections"] if s["id"] == sid), None)

    keywords = [
        (1, ["cost of production", "order creation"]),
        (2, ["och", "order entry"]),
        (3, ["sales order"]),
        (4, ["delivery creation", "sap delivery"]),
        (5, ["delivery acknowledgement", "del ack", "order cycle"]),
        (6, ["cop delivery", "cop del"]),
        (7, ["warehouse replication", "wh replication"]),
        (8, ["post goods", "pgi", "goods issue"]),
        (9, ["invoice"]),
    ]
    for sid, keys in keywords:
        if any(k in q for k in keys):
            return next(s for s in CONFIG["sections"] if s["id"] == sid)
    return None


def _build_status_response(status: str, orders: list[dict], summary: dict) -> str:
    by_sec = []
    for sec in CONFIG["sections"]:
        cnt = sum(1 for o in orders if o["section_id"] == sec["id"])
        if cnt:
            by_sec.append(f"{sec['short']}: {cnt}")
    breakdown = ", ".join(by_sec)
    return (
        f"{len(orders)} orders with status \"{status}\" out of {summary['total']} total. "
        + (f"By section — {breakdown}." if breakdown else "")
    )


def _section_breakdown(orders: list[dict]) -> str:
    by_sec = []
    for sec in CONFIG["sections"]:
        cnt = sum(1 for o in orders if o["section_id"] == sec["id"])
        if cnt:
            by_sec.append(f"{sec['short']}: {cnt}")
    return ("Section breakdown — " + ", ".join(by_sec) + ".") if by_sec else ""


def _fmt_min(minutes: int) -> str:
    if not minutes or minutes <= 0:
        return "–"
    h, m = divmod(minutes, 60)
    return f"{h}h {m}m" if h else f"{m}m"

function globalSummary(orders) {
  const total   = orders.length;
  const onTime  = orders.filter(o => o.status === "On Time").length;
  const delayed = orders.filter(o => o.status === "Delayed").length;
  const failed  = orders.filter(o => o.status === "Failed").length;
  const pending = orders.filter(o => o.status === "Pending").length;
  const breached= orders.filter(o => o.slaStatus === "Breached").length;

  const runtimes = orders.filter(o => o.runtimeMin > 0).map(o => o.runtimeMin);
  const avgRt = runtimes.length ? Math.round(runtimes.reduce((a,b)=>a+b,0)/runtimes.length) : 0;

  return {
    total,
    onTime,
    delayed,
    failed,
    pending,
    successCount: onTime,
    failedCount:  failed,
    slaBreached:  breached,
    onTimeRate:   total ? +(onTime / total * 100).toFixed(1) : 0,
    avgRuntimeStr:fmtMin(avgRt),
    sections: sectionSummary(orders),
    generatedAt: new Date().toISOString(),
  };
}

// ── Voice/NLP query handler ────────────────────────────────
// Returns { responseText, orders, filterApplied }

function handleVoiceQuery(query, allOrders) {
  const q = query.toLowerCase().trim();
  let orders = [];
  let responseText = "";
  let filterApplied = {};

  const summary = globalSummary(allOrders);

  // ── Full summary
  if (/\b(summary|overview|all section|total|full report)\b/.test(q)) {
    responseText =
      `Overall summary: ${summary.total} orders tracked across 9 SAP sections. ` +
      `${summary.onTime} are on time at ${summary.onTimeRate}% on-time rate. ` +
      `${summary.delayed} delayed, ${summary.failed} failed, ${summary.pending} pending. ` +
      `${summary.slaBreached} orders have breached their SLA thresholds.`;
    orders = allOrders;
    filterApplied = {};
  }

  // ── Failed orders
  else if (/\b(fail|error|abort|broken)\b/.test(q)) {
    orders = allOrders.filter(o => o.isFailed);
    filterApplied = { status: "Failed" };
    responseText = buildStatusResponse("Failed", orders, summary);
  }

  // ── Delayed orders
  else if (/\b(delay|late|overdue|behind)\b/.test(q)) {
    orders = allOrders.filter(o => o.status === "Delayed");
    filterApplied = { status: "Delayed" };
    responseText = buildStatusResponse("Delayed", orders, summary);
  }

  // ── On-time orders
  else if (/\b(on.?time|success|complet|done)\b/.test(q)) {
    orders = allOrders.filter(o => o.isSuccess);
    filterApplied = { status: "On Time" };
    responseText = buildStatusResponse("On Time", orders, summary);
  }

  // ── Pending orders
  else if (/\b(pending|in.?progress|running|active)\b/.test(q)) {
    orders = allOrders.filter(o => o.status === "Pending");
    filterApplied = { status: "Pending" };
    responseText = buildStatusResponse("Pending", orders, summary);
  }

  // ── SLA breached
  else if (/\bsla\b/.test(q)) {
    orders = allOrders.filter(o => o.slaStatus === "Breached");
    filterApplied = { slaBreached: "true" };
    responseText = `${orders.length} orders have breached their SLA thresholds. ` +
      sectionBreakdown(orders);
  }

  // ── Specific order ID
  else if (/ord-?\d+/i.test(q)) {
    const idMatch = q.match(/ord-?(\d+)/i);
    const searchId = `ORD-${idMatch[1]}`;
    orders = allOrders.filter(o => o.orderId.toUpperCase() === searchId.toUpperCase());
    filterApplied = { orderId: searchId };
    if (orders.length) {
      const o = orders[0];
      responseText =
        `Order ${o.orderId}: Section ${o.sectionId} — ${o.sectionShort}. ` +
        `Status: ${o.status}. ` +
        `Started: ${fmtDate(o.startTime)}. ` +
        (o.endTime ? `Ended: ${fmtDate(o.endTime)}. ` : "Still running. ") +
        `Runtime: ${o.runtimeStr}. SLA: ${o.slaStatus}. ` +
        `Application: ${o.application}. Created by: ${o.createdBy}.`;
    } else {
      responseText = `No order found matching ${searchId}.`;
    }
  }

  // ── Section-specific queries (by name or number)
  else {
    const sec = matchSection(q);
    if (sec) {
      orders = allOrders.filter(o => o.sectionId === sec.id);
      filterApplied = { sectionId: sec.id };
      const ss = summary.sections.find(s => s.sectionId === sec.id);
      responseText =
        `Section ${sec.id} — ${sec.name}: ${ss.total} orders. ` +
        `${ss.onTime} on time (${ss.onTimeRate}%), ${ss.delayed} delayed, ` +
        `${ss.failed} failed, ${ss.pending} pending. ` +
        `SLA threshold: ${ss.slaMinutes} minutes. ` +
        `Average runtime: ${ss.avgRuntimeStr}. ` +
        `${ss.slaBreached} orders breached SLA.`;
    }
  }

  // ── Critical / urgent
  if (/\b(critical|urgent|worst|most delay)\b/.test(q)) {
    const ranked = summary.sections
      .filter(s => s.delayed + s.failed > 0)
      .sort((a,b) => (b.delayed + b.failed) - (a.delayed + a.failed));
    orders = allOrders.filter(o => o.status === "Delayed" || o.isFailed);
    filterApplied = { status: "Delayed/Failed" };
    responseText =
      `Critical status: ${orders.length} orders need attention. ` +
      `Most impacted sections: ` +
      ranked.slice(0, 3).map(s => `${s.sectionShort} with ${s.delayed + s.failed} issues`).join(", ") + ".";
  }

  // ── Fallback
  if (!responseText) {
    responseText =
      `I didn't catch a specific query. You have ${summary.total} orders: ` +
      `${summary.onTime} on time, ${summary.delayed} delayed, ` +
      `${summary.failed} failed, ${summary.pending} pending. ` +
      `Try asking about a specific section, order ID, or status like "show delayed orders".`;
    orders = allOrders;
  }

  return { responseText, orders: orders.slice(0, CONFIG.maxPageSize), filterApplied };
}

// ── Helpers ────────────────────────────────────────────────

function matchSection(q) {
  // By number
  const numMatch = q.match(/section\s*(\d)/);
  if (numMatch) return CONFIG.sections.find(s => s.id === Number(numMatch[1]));

  // By keyword
  const keywords = [
    [1, ["cost of production", "order creation", "cop order"]],
    [2, ["och", "order entry"]],
    [3, ["sales order"]],
    [4, ["delivery creation", "sap delivery"]],
    [5, ["delivery acknowledgement", "del ack", "order cycle"]],
    [6, ["cop delivery", "cop del"]],
    [7, ["warehouse replication", "wh replication"]],
    [8, ["post goods", "pgi", "warehouse pgi", "goods issue"]],
    [9, ["invoice", "invoice generation"]],
  ];

  for (const [id, keys] of keywords) {
    if (keys.some(k => q.includes(k))) return CONFIG.sections.find(s => s.id === id);
  }
  return null;
}

function buildStatusResponse(status, orders, summary) {
  const bySec = CONFIG.sections.map(sec => {
    const cnt = orders.filter(o => o.sectionId === sec.id).length;
    return cnt > 0 ? `${sec.short}: ${cnt}` : null;
  }).filter(Boolean);

  return (
    `${orders.length} orders with status "${status}" out of ${summary.total} total. ` +
    (bySec.length ? `By section — ${bySec.join(", ")}.` : "")
  );
}

function sectionBreakdown(orders) {
  const bySec = CONFIG.sections.map(sec => {
    const cnt = orders.filter(o => o.sectionId === sec.id).length;
    return cnt > 0 ? `${sec.short}: ${cnt}` : null;
  }).filter(Boolean);
  return bySec.length ? `Section breakdown — ${bySec.join(", ")}.` : "";
}

function fmtMin(min) {
  if (!min || min <= 0) return "–";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(d) {
  if (!d) return "–";
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

module.exports = { applyFilters, paginate, sectionSummary, globalSummary, handleVoiceQuery };
