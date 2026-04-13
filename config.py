"""
================================================================
  SAP ORDER TRACKING BACKEND — CENTRAL CONFIG  (Python version)
  Change parameters here; nothing else needs to be touched
================================================================
"""

import os

CONFIG = {

    # ── Server ────────────────────────────────────────────────
    "server": {
        "port": 3000,
        "host": "0.0.0.0",
        "debug": False,
    },

    # ── Data source ───────────────────────────────────────────
    # Set mode to:
    #   "mock"      → auto-generated demo data (default)
    #   "sap_odata" → live SAP OData service
    #   "database"  → PostgreSQL / MySQL / SQLite via SQLAlchemy
    #   "csv"       → flat CSV file
    "datasource": {
        "mode": "mock",

        "sap_odata": {
            "base_url":  "https://your-sap-host:8080/sap/opu/odata/sap",
            "service":   "ZSD_ORDER_TRACKING_SRV",
            "entity":    "OrderSet",
            "username":  os.environ.get("SAP_USER", "sap_user"),
            "password":  os.environ.get("SAP_PASS", "sap_pass"),
            "client":    os.environ.get("SAP_CLIENT", "100"),
            # OData $select — use your actual SAP field names
            "fields":    "OrderId,SectionId,Status,StartTime,EndTime,Application,CreatedBy,Plant",
        },

        "database": {
            # SQLAlchemy connection string examples:
            #   PostgreSQL : "postgresql://user:pass@host:5432/dbname"
            #   MySQL      : "mysql+pymysql://user:pass@host:3306/dbname"
            #   SQLite     : "sqlite:///orders.db"
            #   MSSQL      : "mssql+pyodbc://user:pass@host/dbname?driver=ODBC+Driver+17+for+SQL+Server"
            "url":   os.environ.get("DB_URL", "postgresql://user:pass@localhost:5432/sap_orders"),
            "table": "order_tracking",   # table or view to query
        },

        "csv": {
            "file_path": "./data/orders.csv",
            "watch":     True,   # reload on file change
        },
    },

    # ── Field mapping ─────────────────────────────────────────
    # Maps your source column names → internal names.
    # Only change the RIGHT side to match your source system.
    "field_map": {
        "order_id":    "OrderId",
        "section_id":  "SectionId",
        "status":      "Status",
        "start_time":  "StartTime",
        "end_time":    "EndTime",
        "application": "Application",
        "created_by":  "CreatedBy",
        "plant":       "Plant",
    },

    # ── Status normalisation ──────────────────────────────────
    # Map your source status codes → canonical values.
    # Canonical: "On Time" | "Delayed" | "Pending" | "Failed"
    "status_map": {
        "C":       "On Time",
        "COMP":    "On Time",
        "SUCCESS": "On Time",
        "On Time": "On Time",
        "D":       "Delayed",
        "DELAY":   "Delayed",
        "Delayed": "Delayed",
        "E":       "Failed",
        "ERROR":   "Failed",
        "ABRT":    "Failed",
        "Failed":  "Failed",
        "I":       "Pending",
        "INPROG":  "Pending",
        "Pending": "Pending",
    },

    # ── The 9 lifecycle sections ──────────────────────────────
    "sections": [
        {"id": 1, "name": "Cost of Production — Order Creation",  "short": "Order Creation"   },
        {"id": 2, "name": "OCH — Order Entry",                    "short": "OCH Entry"        },
        {"id": 3, "name": "SAP — Sales Order Creation",           "short": "Sales Order"      },
        {"id": 4, "name": "SAP — Delivery Creation",              "short": "Delivery Creation"},
        {"id": 5, "name": "Delivery Acknowledgement (OCH)",       "short": "Del Ack OCH"      },
        {"id": 6, "name": "COP — Delivery Acknowledgement",       "short": "COP Del Ack"      },
        {"id": 7, "name": "Warehouse Replication",                "short": "WH Replication"   },
        {"id": 8, "name": "Warehouse — Post Goods Issue",         "short": "WH PGI"           },
        {"id": 9, "name": "SAP — Invoice Generation",             "short": "Invoice Gen"      },
    ],

    # ── SLA thresholds (minutes per section) ─────────────────
    # If runtime exceeds this → order is flagged "Breached"
    "sla": {
        1: 60,    # Order Creation       → 1 h
        2: 30,    # OCH Entry            → 30 min
        3: 45,    # Sales Order          → 45 min
        4: 60,    # Delivery Creation    → 1 h
        5: 30,    # Del Ack OCH          → 30 min
        6: 30,    # COP Del Ack          → 30 min
        7: 90,    # WH Replication       → 1.5 h
        8: 60,    # WH PGI               → 1 h
        9: 45,    # Invoice Gen          → 45 min
    },

    # ── Refresh interval (seconds) ────────────────────────────
    "refresh_interval": 30,

    # ── Pagination ────────────────────────────────────────────
    "default_page_size": 50,
    "max_page_size":     500,

    # ── CORS allowed origins ──────────────────────────────────
    "cors_origins": ["http://localhost:5173", "http://localhost:3000", "*"],
              }
