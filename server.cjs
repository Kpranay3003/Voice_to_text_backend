/**
 * server.js  —  Rapid Dashboard Backend (Node.js + Express, CommonJS)
 *
 * Install:
 *     npm install express cors xlsx axios dotenv
 *
 * Run:
 *     node server.js
 */

"use strict";

const express    = require("express");
const cors       = require("cors");
const XLSX       = require("xlsx");
const axios      = require("axios");
const path       = require("path");
require("dotenv").config();

// ── API Key ──────────────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

if (!ANTHROPIC_API_KEY) {
  console.log("⚠️  WARNING: ANTHROPIC_API_KEY not set in .env file!");
  console.log("   AI chat will not work until you add it.");
} else {
  console.log("✅ Anthropic API key loaded successfully.");
}

// ════════════════════════════════════════════════════════════
//  STARTUP — load entire Excel into memory once
// ════════════════════════════════════════════════════════════
const EXCEL_PATH  = path.join(__dirname, "data.xlsx");
const SHEET_CACHE = {};

function loadExcelToCache() {
  console.log(`\n📂 Loading ${EXCEL_PATH} into memory...`);
  let wb;
  try {
    wb = XLSX.readFile(EXCEL_PATH);
  } catch (err) {
    console.log(`❌ ERROR: data.xlsx not found. Place it next to server.js`);
    return;
  }

  for (const sheetName of wb.SheetNames) {
    const sheet   = wb.Sheets[sheetName];
    const rows    = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    if (!rows.length) {
      SHEET_CACHE[sheetName] = [];
      continue;
    }

    const headers = rows[0].map((h, i) =>
      h !== null && h !== undefined && String(h).trim() !== ""
        ? String(h).trim()
        : `col_${i}`
    );

    const records = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.every(v => v === null || v === undefined || v === "")) continue;
      const record = {};
      headers.forEach((h, i) => {
        record[h] = row[i] !== null && row[i] !== undefined ? String(row[i]) : "";
      });
      records.push(record);
    }

    SHEET_CACHE[sheetName] = records;
    console.log(`   ✅ '${sheetName}' — ${records.length.toLocaleString()} rows cached`);
  }

  console.log("\n🚀 All sheets loaded. Serving from memory.\n");
}

loadExcelToCache();

// ════════════════════════════════════════════════════════════
//  EXPRESS APP
// ════════════════════════════════════════════════════════════
const app = express();

app.use(cors());
app.use(express.json());

// ── GET /api/node/:nodeId ────────────────────────────────────
app.get("/api/node/:nodeId", (req, res) => {
  const { nodeId } = req.params;
  res.json(SHEET_CACHE[nodeId] || []);
});

// ── GET /api/summary/:nodeId ─────────────────────────────────
app.get("/api/summary/:nodeId", (req, res) => {
  const { nodeId } = req.params;
  const data = SHEET_CACHE[nodeId] || [];

  const total    = data.length;
  const success  = data.filter(d => (d["Status"]   || "").toUpperCase() === "SUCCESS").length;
  const failed   = data.filter(d => (d["Status"]   || "").toUpperCase() === "FAILED").length;
  const critical = data.filter(d => (d["CRITICAL"] || "").toUpperCase() === "YES").length;

  res.json({ total, success, failed, critical });
});

// ── GET /api/health ──────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status:  "ok",
    excel:   Object.keys(SHEET_CACHE).length ? EXCEL_PATH : "NOT FOUND",
    sheets:  Object.entries(SHEET_CACHE).map(([name, rows]) => ({ name, rows: rows.length })),
    api_key: ANTHROPIC_API_KEY ? "set ✅" : "NOT SET ⚠️",
  });
});

// ── POST /api/chat ───────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages, systemPrompt = "You are a helpful dashboard assistant." } = req.body;

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({
      detail: "ANTHROPIC_API_KEY not set in .env file. Add it and restart server.",
    });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ detail: "messages array is required." });
  }

  const payload = {
    model:      "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system:     systemPrompt,
    messages:   messages.map(m => ({
      role:    m.role,
      content: m.content,
    })),
  };

  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      payload,
      {
        headers: {
          "x-api-key":         ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type":      "application/json",
        },
        timeout: 30000,
      }
    );
    res.json(response.data);
  } catch (err) {
    const detail = err.response?.data || err.message || "Failed to reach Anthropic.";
    res.status(502).json({ detail });
  }
});

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Rapid Dashboard API running on http://localhost:${PORT}`);
});