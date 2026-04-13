# SAP Order Tracker — Backend

Node.js/Express backend for tracking 100 orders across 9 SAP lifecycle sections,
with a voice-query NLP engine and full REST API.

---

## Quick Start

```bash
npm install
node server.js
# → http://localhost:3000
```

---

## Folder Structure

```
sap-tracker/
├── config.js        ← ★ ONLY file you normally need to edit
├── server.js        ← Express entry point
├── routes.js        ← All HTTP endpoints
├── analytics.js     ← Query / aggregation engine
├── dataAdapter.js   ← Source connector (mock / SAP / DB / CSV)
├── data/
│   └── orders.csv   ← Sample CSV (used when mode = "csv")
└── package.json
```

---

## Configuration (`config.js`)

### Switch data source

```js
datasource: {
  mode: "mock"      // ← change this one line
}
```

| mode | description |
|------|-------------|
| `"mock"` | 100 randomly generated orders (default) |
| `"sap_odata"` | Live SAP OData service |
| `"database"` | Postgres / MySQL / MSSQL / SQLite via Sequelize |
| `"csv"` | Flat CSV file (re-reads on each poll) |

### Connect to SAP OData

```js
datasource: {
  mode: "sap_odata",
  sap_odata: {
    baseUrl: "https://YOUR-SAP-HOST:8080/sap/opu/odata/sap",
    service:  "ZSD_ORDER_TRACKING_SRV",
    entity:   "OrderSet",
    username: "sap_user",          // or use process.env.SAP_USER
    password: "sap_pass",
    client:   "100",
    fields:   "OrderId,SectionId,Status,StartTime,EndTime,Application,CreatedBy,Plant",
  }
}
```

### Connect to a database

```js
datasource: {
  mode: "database",
  database: {
    dialect:  "postgres",          // "postgres"|"mysql"|"mssql"|"sqlite"
    host:     "db.example.com",
    port:     5432,
    name:     "sap_orders",
    user:     "db_user",
    password: "db_pass",
    table:    "order_tracking",    // your table or view name
  }
}
```
Install the matching driver: `npm install pg` (Postgres) or `npm install mysql2`.

### Map your field names

If your SAP entity or DB table uses different column names, update `fieldMap`:

```js
fieldMap: {
  orderId:     "AUFNR",     // ← your source field name on the right
  sectionId:   "SECTION",
  status:      "STAT",
  startTime:   "ERDAT",
  endTime:     "ENDDAT",
  application: "APP_NAME",
  createdBy:   "ERNAM",
  plant:       "WERKS",
}
```

### Map your status codes

```js
statusMap: {
  "COMP": "On Time",
  "ABRT": "Failed",
  // add any code your system produces
}
```

### Adjust SLA thresholds (minutes)

```js
sla: {
  1: 60,   // Section 1 SLA = 60 min
  9: 45,   // Section 9 SLA = 45 min
  // ...
}
```

---

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server status |
| GET | `/api/summary` | Global + per-section counts, rates, runtimes |
| GET | `/api/sections` | All 9 sections with stats |
| GET | `/api/sections/:id` | Single section detail + paginated orders |
| GET | `/api/orders` | All orders (filterable, sortable, paginated) |
| GET | `/api/orders/:id` | Single order full detail |
| POST | `/api/voice` | NLP voice query → response text + filtered orders |
| GET | `/api/refresh` | Force data reload from source |

### Order filters (query params)

```
GET /api/orders?status=Delayed&sectionId=4&page=1&size=20
GET /api/orders?slaBreached=true&sort=runtimeMin&order=desc
GET /api/orders?dateFrom=2025-04-01&dateTo=2025-04-07
GET /api/orders?application=SAP+Fiori&plant=PL01
```

### Voice query

```bash
curl -X POST http://localhost:3000/api/voice \
  -H "Content-Type: application/json" \
  -d '{"query": "show me all delayed orders in section 4"}'
```

Response:
```json
{
  "query": "show me all delayed orders in section 4",
  "responseText": "SAP Delivery Creation (Section 4): ...",
  "filterApplied": { "sectionId": 4, "status": "Delayed" },
  "orderCount": 3,
  "orders": [ ... ],
  "summary": { "total": 100, "onTime": 74, ... }
}
```

### Order record fields

| Field | Type | Description |
|-------|------|-------------|
| `orderId` | string | Unique order identifier |
| `sectionId` | number | 1–9 |
| `sectionName` | string | Full section name |
| `status` | string | On Time / Delayed / Pending / Failed |
| `startTime` | ISO date | Order creation timestamp |
| `endTime` | ISO date \| null | Completion timestamp |
| `runtimeMin` | number | Elapsed minutes |
| `runtimeStr` | string | Human-readable e.g. `2h 14m` |
| `slaMin` | number | SLA threshold for this section |
| `slaStatus` | string | Within SLA / Breached |
| `application` | string | Source application |
| `createdBy` | string | User/system that created the order |
| `plant` | string | Plant/facility code |
| `isSuccess` | boolean | true if status = On Time |
| `isFailed` | boolean | true if status = Failed |

---

## Voice query examples

```
"summary of all sections"
"show delayed orders"
"failed orders today"
"SLA breached"
"section 9 status"
"invoice generation"
"warehouse post goods issue"
"show order ORD-1042"
"which section is most critical"
"pending orders in SAP delivery creation"
```

---

## Environment variables

```
SAP_USER     SAP OData username
SAP_PASS     SAP OData password
SAP_CLIENT   SAP client number (default 100)
DB_HOST      Database host
DB_PORT      Database port
DB_NAME      Database name
DB_USER      Database user
DB_PASS      Database password
```
