"""
server.py  —  Entry point
Start with:  python server.py
"""

from flask import Flask, send_from_directory
from flask_cors import CORS
import os

from config import CONFIG
from routes import api

app = Flask(__name__, static_folder="public")

# ── CORS ───────────────────────────────────────────────────
CORS(app, origins=CONFIG["cors_origins"])

# ── Register API blueprint ─────────────────────────────────
app.register_blueprint(api)

# ── Serve frontend from /public ────────────────────────────
@app.get("/")
def index():
    return send_from_directory("public", "index.html")

@app.get("/<path:path>")
def static_files(path):
    return send_from_directory("public", path)

# ── Run ────────────────────────────────────────────────────
if __name__ == "__main__":
    port  = CONFIG["server"]["port"]
    host  = CONFIG["server"]["host"]
    debug = CONFIG["server"]["debug"]

    print(f"\n✅  SAP Order Tracker (Python) running at http://localhost:{port}")
    print(f"   Data source mode : {CONFIG['datasource']['mode']}")
    print(f"   Sections tracked : {len(CONFIG['sections'])}")
    print(f"   Refresh interval : {CONFIG['refresh_interval']}s\n")

    app.run(host=host, port=port, debug=debug)
