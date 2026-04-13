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
"""
data_adapter.py
────────────────────────────────────────────────────────────
Unified data layer.  Switch CONFIG["datasource"]["mode"] and
this file handles the rest.  Returns normalised OrderRecord
dicts regardless of source.

OrderRecord shape:
{
    "order_id":      str,
    "section_id":    int,        # 1–9
    "section_name":  str,
    "section_short": str,
    "status":        str,        # "On Time"|"Delayed"|"Pending"|"Failed"
    "start_time":    str,        # ISO 8601
    "end_time":      str|None,
    "runtime_min":   int,        # computed minutes
    "runtime_str":   str,        # human "2h 14m"
    "sla_min":       int,        # SLA threshold for this section
    "sla_status":    str,        # "Within SLA" | "Breached"
    "application":   str,
    "created_by":    str,
    "plant":         str,
    "is_success":    bool,
    "is_failed":     bool,
}
"""

import csv
import random
import time
import re
from datetime import datetime, timedelta, timezone
from config import CONFIG

# ── Cache ──────────────────────────────────────────────────
_cache = []
_last_fetch = 0


# ── Helpers ────────────────────────────────────────────────

def normalise_status(raw: str) -> str:
    """Map source status code → canonical status string."""
    sm = CONFIG["status_map"]
    return sm.get(str(raw), sm.get(str(raw).upper(), "Pending"))


def parse_date(val) -> datetime | None:
    """Parse SAP OData /Date()/, ISO strings, or None."""
    if not val:
        return None
    s = str(val)
    # SAP OData timestamp: /Date(1700000000000)/
    m = re.search(r"/Date\((\d+)\)/", s)
    if m:
        return datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc)
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def runtime_minutes(start: datetime | None, end: datetime | None) -> int:
    if not start:
        return 0
    end = end or datetime.now(tz=timezone.utc)
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    return max(0, int((end - start).total_seconds() / 60))


def fmt_runtime(minutes: int) -> str:
    if minutes <= 0:
        return "–"
    h, m = divmod(minutes, 60)
    return f"{h}h {m}m" if h else f"{m}m"


def fmt_date(dt: datetime | None) -> str | None:
    if not dt:
        return None
    return dt.isoformat()


def section_by_id(section_id: int) -> dict:
    return next(
        (s for s in CONFIG["sections"] if s["id"] == section_id),
        CONFIG["sections"][0],
    )


def map_record(raw: dict) -> dict:
    """Map a raw source row → normalised OrderRecord."""
    fm = CONFIG["field_map"]
    section_id  = int(raw.get(fm["section_id"], 1) or 1)
    section     = section_by_id(section_id)
    start_time  = parse_date(raw.get(fm["start_time"]))
    end_time    = parse_date(raw.get(fm["end_time"]))
    rt_min      = runtime_minutes(start_time, end_time)
    sla_min     = CONFIG["sla"].get(section_id, 60)
    status      = normalise_status(raw.get(fm["status"], ""))

    return {
        "order_id":     raw.get(fm["order_id"], f"ORD-{random.randint(1000,9999)}"),
        "section_id":   section_id,
        "section_name": section["name"],
        "section_short":section["short"],
        "status":       status,
        "start_time":   fmt_date(start_time),
        "end_time":     fmt_date(end_time),
        "runtime_min":  rt_min,
        "runtime_str":  fmt_runtime(rt_min),
        "sla_min":      sla_min,
        "sla_status":   "Breached" if rt_min > sla_min else "Within SLA",
        "application":  raw.get(fm["application"], "–"),
        "created_by":   raw.get(fm["created_by"],  "–"),
        "plant":        raw.get(fm["plant"],        "–"),
        "is_success":   status == "On Time",
        "is_failed":    status == "Failed",
    }


# ── Mock data generator ────────────────────────────────────

def generate_mock_orders(count: int = 100) -> list[dict]:
    apps  = ["SAP Fiori", "ERP Portal", "OCH Web", "Mobile WMS", "B2B Gateway", "COP System"]
    users = ["JSMITH", "APATEL", "MWANG", "LGARCIA", "OBROWN"]
    plants= ["PL01", "PL02", "PL03", "PL04"]
    # Weighted toward success
    statuses = ["C", "C", "C", "D", "I", "E"]
    now = datetime.now(tz=timezone.utc)

    records = []
    fm = CONFIG["field_map"]

    for i in range(1, count + 1):
        section_id = ((i - 1) % 9) + 1
        sla_min    = CONFIG["sla"][section_id]
        raw_status = random.choice(statuses)
        offset_days= random.randint(0, 9)
        offset_hrs = random.uniform(0, 8)
        start = now - timedelta(days=offset_days, hours=offset_hrs)
        run_min= None if raw_status == "I" else random.randint(5, int(sla_min * 1.6))
        end   = start + timedelta(minutes=run_min) if run_min else None

        records.append({
            fm["order_id"]:    f"ORD-{1000 + i}",
            fm["section_id"]:  section_id,
            fm["status"]:      raw_status,
            fm["start_time"]:  start.isoformat(),
            fm["end_time"]:    end.isoformat() if end else None,
            fm["application"]: random.choice(apps),
            fm["created_by"]:  random.choice(users),
            fm["plant"]:       random.choice(plants),
        })

    return [map_record(r) for r in records]


# ── SAP OData fetch ────────────────────────────────────────

def fetch_from_sap() -> list[dict]:
    import requests
    cfg = CONFIG["datasource"]["sap_odata"]
    url = (
        f"{cfg['base_url']}/{cfg['service']}/{cfg['entity']}"
        f"?$format=json&$select={cfg['fields']}&sap-client={cfg['client']}"
    )
    resp = requests.get(url, auth=(cfg["username"], cfg["password"]), timeout=30)
    resp.raise_for_status()
    data = resp.json()
    raw_list = data.get("d", {}).get("results", data.get("value", []))
    return [map_record(r) for r in raw_list]


# ── Database fetch ─────────────────────────────────────────

def fetch_from_db() -> list[dict]:
    from sqlalchemy import create_engine, text
    cfg = CONFIG["datasource"]["database"]
    engine = create_engine(cfg["url"])
    fm = CONFIG["field_map"]
    cols = ", ".join(fm.values())
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT {cols} FROM {cfg['table']}")).mappings().all()
    return [map_record(dict(r)) for r in rows]


# ── CSV fetch ──────────────────────────────────────────────

def fetch_from_csv() -> list[dict]:
    cfg = CONFIG["datasource"]["csv"]
    records = []
    with open(cfg["file_path"], newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            records.append(map_record(dict(row)))
    return records


# ── Public API ─────────────────────────────────────────────

def fetch_orders(force_refresh: bool = False) -> list[dict]:
    global _cache, _last_fetch
    now = time.time()

    if not force_refresh and _cache and (now - _last_fetch) < CONFIG["refresh_interval"]:
        return _cache

    try:
        mode = CONFIG["datasource"]["mode"]
        if mode == "sap_odata":
            data = fetch_from_sap()
        elif mode == "database":
            data = fetch_from_db()
        elif mode == "csv":
            data = fetch_from_csv()
        else:
            data = generate_mock_orders(100)

        _cache = data
        _last_fetch = now
        print(f"[DataAdapter] Loaded {len(data)} orders via mode='{mode}'")
        return data

    except Exception as e:
        print(f"[DataAdapter] Fetch failed: {e}")
        if _cache:
            print("[DataAdapter] Returning stale cache")
            return _cache
        raise
