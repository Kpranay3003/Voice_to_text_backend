export const nodesConfig = [
  // Row 1
  {
    id: "cop hop",
    label: "COP – Order\nCreation",
    aliases: ["cop order creation", "cop order", "order creation"],
    x: 60, y: 40,
  },
  {
    id: "och hop",
    label: "OCH – Order\nEntry",
    aliases: ["och order entry", "och order", "order entry"],
    x: 230, y: 40,
  },
  {
    id: "sap hop",
    label: "SAP-Sales Order\ncreation",
    aliases: ["sap sales order", "sap sales", "sales order creation", "sales order"],
    x: 400, y: 40,
  },
  {
    id: "sap delivery hop",
    label: "SAP-Delivery\nCreation",
    aliases: ["sap delivery creation", "sap delivery", "delivery creation"],
    x: 570, y: 40,
  },
  {
    id: "och del hop",
    label: "OCH – Delivery\nAcknowledgement",
    aliases: ["och delivery acknowledgement", "och delivery ack", "delivery acknowledgement", "och del"],
    x: 740, y: 40,
  },
  // Row 2
  {
    id: "cop del hop",
    label: "COP – Delivery\nAcknowledgement",
    aliases: ["cop delivery acknowledgement", "cop delivery ack", "cop delivery", "cop del"],
    x: 60, y: 200,
  },
  {
    id: "wms rep hop",
    label: "WMS –\nReplication",
    aliases: ["wms replication", "wms rep", "replication"],
    x: 280, y: 200,
  },
  {
    id: "wms pgi hop",
    label: "WMS-PGI Status",
    // Many aliases to catch speech recognition variants of "PGI"
    aliases: [
      "wms pgi status", "wms pgi", "pgi status", "pgi",
      "wms peggy", "wms pg", "wms pjy", "wms fiji",
      "wms pgi hop", "wms p g i", "wms p.g.i",
    ],
    x: 490, y: 200,
  },
];

export const edgesConfig = [
  { id: "e1", source: "cop hop",          target: "och hop",          type: "straight" },
  { id: "e2", source: "och hop",          target: "sap hop",          type: "straight" },
  { id: "e3", source: "sap hop",          target: "sap delivery hop", type: "straight" },
  { id: "e4", source: "sap delivery hop", target: "och del hop",      type: "straight" },
  { id: "e5", source: "cop del hop",      target: "wms rep hop",      type: "straight" },
  { id: "e6", source: "wms rep hop",      target: "wms pgi hop",      type: "straight" },
];