/**
 * server.js  —  Entry point
 * Start with:  node server.js
 */

const express = require("express");
const cors    = require("cors");
const CONFIG  = require("./config");
const routes  = require("./routes");

const app = express();

app.use(cors({ origin: CONFIG.corsOrigins }));
app.use(express.json());
app.use(express.static("public"));

// Mount all API routes under /api
app.use("/api", routes);

// Serve a minimal HTML test page at /
app.get("/", (_req, res) => {
  res.send(`
    <html><body style="font-family:sans-serif;max-width:600px;margin:2rem auto">
    <h2>SAP Order Tracker — Backend Running</h2>
    <p>Mode: <strong>${CONFIG.datasource.mode}</strong></p>
    <ul>
      <li><a href="/api/health">/api/health</a></li>
      <li><a href="/api/summary">/api/summary</a></li>
      <li><a href="/api/orders">/api/orders</a></li>
      <li><a href="/api/sections">/api/sections</a></li>
    </ul>
    <p>Voice query test (POST /api/voice): <code>{ "query": "show delayed orders" }</code></p>
    </body></html>
  `);
});

app.listen(CONFIG.server.port, CONFIG.server.host, () => {
  console.log(`\n✅  SAP Order Tracker running at http://localhost:${CONFIG.server.port}`);
  console.log(`   Data source mode : ${CONFIG.datasource.mode}`);
  console.log(`   Sections tracked : ${CONFIG.sections.length}`);
  console.log(`   Refresh interval : ${CONFIG.refreshInterval / 1000}s\n`);
});
