/**
 * analytics.js
 * ──────────────────────────────────────────────────────────
 * All business logic for querying, filtering, aggregating,
 * and summarising order data.  Used by routes.js and the
 * voice NLP engine.
 */

const CONFIG = require("./config");

// ── Filters ────────────────────────────────────────────────

function applyFilters(orders, filters = {}) {
  let result = [...orders];

  if (filters.sectionId)
    result = result.filter(o => o.sectionId === Number(filters.sectionId));

  if (filters.status)
    result = result.filter(o => o.status.toLowerCase() === filters.status.toLowerCase());

  if (filters.application)
    result = result.filter(o => o.application.toLowerCase().includes(filters.application.toLowerCase()));

  if (filters.plant)
    result = result.filter(o => o.plant === filters.plant);

  if (filters.orderId)
    result = result.filter(o => o.orderId.toLowerCase().includes(filters.orderId.toLowerCase()));

  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom);
    result = result.filter(o => o.startTime && o.startTime >= from);
  }

  if (filters.dateTo) {
    const to = new Date(filters.dateTo);
    result = result.filter(o => o.startTime && o.startTime <= to);
  }

  if (filters.slaBreached === "true")
    result = result.filter(o => o.slaStatus === "Breached");

  return result;
}

// ── Pagination ─────────────────────────────────────────────

function paginate(list, page = 1, size = CONFIG.defaultPageSize) {
  const s = Math.min(size, CONFIG.maxPageSize);
  const total = list.length;
  const start = (page - 1) * s;
  const items = list.slice(start, start + s);
  return {
    items,
    pagination: { page, size: s, total, pages: Math.ceil(total / s) },
  };
}

// ── Section summary ────────────────────────────────────────

function sectionSummary(orders) {
  return CONFIG.sections.map(sec => {
    const group = orders.filter(o => o.sectionId === sec.id);
    const onTime  = group.filter(o => o.status === "On Time").length;
    const delayed = group.filter(o => o.status === "Delayed").length;
    const failed  = group.filter(o => o.status === "Failed").length;
    const pending = group.filter(o => o.status === "Pending").length;
    const breached= group.filter(o => o.slaStatus === "Breached").length;
    const runtimes= group.filter(o => o.runtimeMin > 0).map(o => o.runtimeMin);
    const avgRt   = runtimes.length ? Math.round(runtimes.reduce((a,b)=>a+b,0)/runtimes.length) : 0;
    const maxRt   = runtimes.length ? Math.max(...runtimes) : 0;

    return {
      sectionId:    sec.id,
      sectionName:  sec.name,
      sectionShort: sec.short,
      slaMinutes:   CONFIG.sla[sec.id],
      total:        group.length,
      onTime,
      delayed,
      failed,
      pending,
      successCount: onTime,
      failedCount:  failed,
      slaBreached:  breached,
      onTimeRate:   group.length ? +(onTime / group.length * 100).toFixed(1) : 0,
      avgRuntimeMin:avgRt,
      maxRuntimeMin:maxRt,
      avgRuntimeStr:fmtMin(avgRt),
      maxRuntimeStr:fmtMin(maxRt),
    };
  });
}

// ── Global summary ─────────────────────────────────────────

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
