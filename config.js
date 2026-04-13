/**
 * ============================================================
 *  SAP ORDER TRACKING BACKEND — CENTRAL CONFIG
 *  Change parameters here; nothing else needs to be touched
 * ============================================================
 */

const CONFIG = {

  // ── Server ─────────────────────────────────────────────────
  server: {
    port: 3000,
    host: "0.0.0.0",
  },

  // ── SAP / Data source connection ───────────────────────────
  // Set mode to "mock" for demo data, "sap_odata" for live SAP,
  // "database" for your own DB, or "csv" for flat-file import.
  datasource: {
    mode: "mock",           // "mock" | "sap_odata" | "database" | "csv"

    sap_odata: {
      baseUrl: "https://your-sap-host:8080/sap/opu/odata/sap",
      service:  "ZSD_ORDER_TRACKING_SRV",
      entity:   "OrderSet",
      username: process.env.SAP_USER || "sap_user",
      password: process.env.SAP_PASS || "sap_pass",
      client:   process.env.SAP_CLIENT || "100",
      // OData $select fields — map to your SAP field names
      fields:   "OrderId,SectionId,Status,StartTime,EndTime,Application,CreatedBy,Plant",
    },

    database: {
      // Supported: "postgres" | "mysql" | "mssql" | "sqlite"
      dialect:  "postgres",
      host:     process.env.DB_HOST || "localhost",
      port:     process.env.DB_PORT || 5432,
      name:     process.env.DB_NAME || "sap_orders",
      user:     process.env.DB_USER || "db_user",
      password: process.env.DB_PASS || "db_pass",
      table:    "order_tracking",           // table/view to query
    },

    csv: {
      filePath: "./data/orders.csv",        // path to your CSV
      watch:    true,                       // auto-reload on file change
    },
  },

  // ── Field mapping ──────────────────────────────────────────
  // Maps your source field names → internal field names.
  // Only change the LEFT side (source names).
  fieldMap: {
    orderId:     "OrderId",       // unique order identifier
    sectionId:   "SectionId",     // 1–9
    status:      "Status",        // raw status string from source
    startTime:   "StartTime",     // ISO 8601 or SAP timestamp
    endTime:     "EndTime",
    application: "Application",   // originating app name
    createdBy:   "CreatedBy",
    plant:       "Plant",
  },

  // ── Status normalisation ───────────────────────────────────
  // Map your source system's status codes → canonical values.
  // Canonical: "On Time" | "Delayed" | "Pending" | "Failed"
  statusMap: {
    "C":         "On Time",    // SAP Complete
    "COMP":      "On Time",
    "SUCCESS":   "On Time",
    "On Time":   "On Time",
    "D":         "Delayed",
    "DELAY":     "Delayed",
    "Delayed":   "Delayed",
    "E":         "Failed",
    "ERROR":     "Failed",
    "ABRT":      "Failed",
    "Failed":    "Failed",
    "I":         "Pending",
    "INPROG":    "Pending",
    "Pending":   "Pending",
  },

  // ── The 9 lifecycle sections ───────────────────────────────
  sections: [
    { id: 1, name: "Cost of Production — Order Creation",   short: "Order Creation"   },
    { id: 2, name: "OCH — Order Entry",                     short: "OCH Entry"        },
    { id: 3, name: "SAP — Sales Order Creation",            short: "Sales Order"      },
    { id: 4, name: "SAP — Delivery Creation",               short: "Delivery Creation"},
    { id: 5, name: "Delivery Acknowledgement (OCH)",        short: "Del Ack OCH"      },
    { id: 6, name: "COP — Delivery Acknowledgement",        short: "COP Del Ack"      },
    { id: 7, name: "Warehouse Replication",                 short: "WH Replication"   },
    { id: 8, name: "Warehouse — Post Goods Issue",          short: "WH PGI"           },
    { id: 9, name: "SAP — Invoice Generation",              short: "Invoice Gen"      },
  ],

  // ── SLA thresholds (minutes per section) ──────────────────
  // If runtime exceeds sla → order is "Delayed"
  sla: {
    1: 60,   // Order Creation       → 1 h
    2: 30,   // OCH Entry            → 30 min
    3: 45,   // Sales Order          → 45 min
    4: 60,   // Delivery Creation    → 1 h
    5: 30,   // Del Ack OCH          → 30 min
    6: 30,   // COP Del Ack          → 30 min
    7: 90,   // WH Replication       → 1.5 h
    8: 60,   // WH PGI               → 1 h
    9: 45,   // Invoice Gen          → 45 min
  },

  // ── Refresh interval (ms) ─────────────────────────────────
  refreshInterval: 30_000,    // poll data source every 30 s

  // ── Pagination ────────────────────────────────────────────
  defaultPageSize: 50,
  maxPageSize:     500,

  // ── CORS allowed origins ──────────────────────────────────
  corsOrigins: ["http://localhost:5173", "http://localhost:3000"],
};

module.exports = CONFIG;
