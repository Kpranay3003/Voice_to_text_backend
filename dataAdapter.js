/**
 * dataAdapter.js
 * ──────────────────────────────────────────────────────────
 * Unified data layer.  Switch CONFIG.datasource.mode and
 * this file handles the rest.  Returns normalised OrderRecord
 * objects regardless of source.
 *
 * OrderRecord shape:
 * {
 *   orderId:      string,
 *   sectionId:    number,       // 1–9
 *   sectionName:  string,
 *   status:       string,       // "On Time"|"Delayed"|"Pending"|"Failed"
 *   startTime:    Date,
 *   endTime:      Date|null,
 *   runtimeMin:   number,       // computed minutes
 *   runtimeStr:   string,       // human "2h 14m"
 *   slaMin:       number,       // SLA threshold for section
 *   slaStatus:    string,       // "Within SLA" | "Breached"
 *   application:  string,
 *   createdBy:    string,
 *   plant:        string,
 *   isSuccess:    boolean,
 *   isFailed:     boolean,
 * }
 */

const CONFIG = require("./config");

// ── Helpers ────────────────────────────────────────────────

function normaliseStatus(raw) {
  return CONFIG.statusMap[raw] ?? CONFIG.statusMap[String(raw).toUpperCase()] ?? "Pending";
}

function parseDate(val) {
  if (!val) return null;
  // SAP OData uses /Date(1700000000000)/
  const sapMatch = String(val).match(/\/Date\((\d+)\)\//);
  if (sapMatch) return new Date(Number(sapMatch[1]));
  return new Date(val);
}

function runtimeMinutes(start, end) {
  if (!start || !end) return 0;
  return Math.round((end - start) / 60_000);
}

function fmtRuntime(minutes) {
  if (minutes <= 0) return "–";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function mapRecord(raw) {
  const fm = CONFIG.fieldMap;
  const sectionId = Number(raw[fm.sectionId]) || 1;
  const section   = CONFIG.sections.find(s => s.id === sectionId) || CONFIG.sections[0];
  const startTime = parseDate(raw[fm.startTime]);
  const endTime   = parseDate(raw[fm.endTime]);
  const rtMin     = runtimeMinutes(startTime, endTime || new Date());
  const slaMin    = CONFIG.sla[sectionId] ?? 60;
  const status    = normaliseStatus(raw[fm.status]);

  return {
    orderId:     raw[fm.orderId]     ?? `ORD-${Math.random().toString(36).slice(2,8).toUpperCase()}`,
    sectionId,
    sectionName: section.name,
    sectionShort:section.short,
    status,
    startTime,
    endTime,
    runtimeMin:  rtMin,
    runtimeStr:  fmtRuntime(rtMin),
    slaMin,
    slaStatus:   rtMin > slaMin ? "Breached" : "Within SLA",
    application: raw[fm.application] ?? "–",
    createdBy:   raw[fm.createdBy]   ?? "–",
    plant:       raw[fm.plant]       ?? "–",
    isSuccess:   status === "On Time",
    isFailed:    status === "Failed",
  };
}

// ── Mock data generator ────────────────────────────────────

function generateMockOrders(count = 100) {
  const apps = ["SAP Fiori", "ERP Portal", "OCH Web", "Mobile WMS", "B2B Gateway", "COP System"];
  const users = ["JSMITH", "APATEL", "MWANG", "LGARCIA", "OBROWN"];
  const plants = ["PL01", "PL02", "PL03", "PL04"];
  const statuses = ["C", "C", "C", "D", "I", "E"]; // weighted toward success
  const days = 10; // span last 10 days

  const records = [];
  for (let i = 1; i <= count; i++) {
    const sectionId = ((i - 1) % 9) + 1;
    const slaMin    = CONFIG.sla[sectionId];
    const rawStatus = statuses[Math.floor(Math.random() * statuses.length)];
    const offsetDays = Math.floor(Math.random() * days);
    const start = new Date(Date.now() - offsetDays * 86_400_000 - Math.random() * 28_800_000);
    const runMin = rawStatus === "I"
      ? null
      : Math.floor(Math.random() * slaMin * 1.6) + 5;
    const end = runMin ? new Date(start.getTime() + runMin * 60_000) : null;

    records.push({
      [CONFIG.fieldMap.orderId]:     `ORD-${1000 + i}`,
      [CONFIG.fieldMap.sectionId]:   sectionId,
      [CONFIG.fieldMap.status]:      rawStatus,
      [CONFIG.fieldMap.startTime]:   start.toISOString(),
      [CONFIG.fieldMap.endTime]:     end ? end.toISOString() : null,
      [CONFIG.fieldMap.application]: apps[Math.floor(Math.random() * apps.length)],
      [CONFIG.fieldMap.createdBy]:   users[Math.floor(Math.random() * users.length)],
      [CONFIG.fieldMap.plant]:       plants[Math.floor(Math.random() * plants.length)],
    });
  }
  return records.map(mapRecord);
}

// ── SAP OData fetch ────────────────────────────────────────

async function fetchFromSAP() {
  const { baseUrl, service, entity, username, password, client, fields } = CONFIG.datasource.sap_odata;
  const url = `${baseUrl}/${service}/${entity}?$format=json&$select=${fields}&sap-client=${client}`;
  const auth = Buffer.from(`${username}:${password}`).toString("base64");

  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) throw new Error(`SAP OData error: ${res.status} ${res.statusText}`);
  const json = await res.json();
  const rawList = json?.d?.results ?? json?.value ?? [];
  return rawList.map(mapRecord);
}

// ── Database fetch ─────────────────────────────────────────

async function fetchFromDB() {
  // Lazy-require so that projects not using a DB don't need the driver
  const { Sequelize, DataTypes } = require("sequelize");
  const { dialect, host, port, name, user, password, table } = CONFIG.datasource.database;

  const sequelize = new Sequelize(name, user, password, {
    host, port, dialect, logging: false,
  });

  const fm = CONFIG.fieldMap;
  // Build column list from fieldMap values
  const cols = Object.values(fm).join(", ");
  const [rows] = await sequelize.query(`SELECT ${cols} FROM ${table}`);
  await sequelize.close();
  return rows.map(mapRecord);
}

// ── CSV fetch ──────────────────────────────────────────────

async function fetchFromCSV() {
  const fs = require("fs");
  const path = require("path");
  const { filePath } = CONFIG.datasource.csv;

  const raw = fs.readFileSync(path.resolve(filePath), "utf8");
  const lines = raw.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());

  const rows = lines.slice(1).map(line => {
    const vals = line.split(",");
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? "").trim(); });
    return obj;
  });

  return rows.map(mapRecord);
}

// ── Public API ─────────────────────────────────────────────

let _cache = [];
let _lastFetch = 0;

async function fetchOrders(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _cache.length && now - _lastFetch < CONFIG.refreshInterval) {
    return _cache;
  }

  try {
    let data;
    switch (CONFIG.datasource.mode) {
      case "sap_odata": data = await fetchFromSAP();     break;
      case "database":  data = await fetchFromDB();      break;
      case "csv":       data = await fetchFromCSV();     break;
      default:          data = generateMockOrders(100);  break;
    }
    _cache = data;
    _lastFetch = now;
    console.log(`[DataAdapter] Loaded ${data.length} orders via mode="${CONFIG.datasource.mode}"`);
    return data;
  } catch (err) {
    console.error("[DataAdapter] Fetch failed:", err.message);
    // Fall back to stale cache if available
    if (_cache.length) {
      console.warn("[DataAdapter] Returning stale cache");
      return _cache;
    }
    throw err;
  }
}

module.exports = { fetchOrders, mapRecord, normaliseStatus };
