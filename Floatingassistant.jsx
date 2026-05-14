/**
 * FloatingAssistant.jsx
 * ─────────────────────
 * 100% local chatbot — zero API key, zero external service.
 * All data comes from your Python backend (localhost:5000).
 *
 * CHAT supports:
 *   hi / hello / hey
 *   help / what can you do
 *   list nodes
 *   total / success / failed for [node]
 *   open / show / navigate to [node]
 *   compare [node] and [node]
 *   which node has most failures / best success
 *   overall summary (all nodes)
 *   status of current node
 *   thank you / bye
 *
 * VOICE supports:
 *   open [node name]
 *   how many failed / success / total
 *   list nodes
 *   stop
 */
import { useState, useEffect, useRef, useCallback } from "react";
import "./FloatingAssistant.css";
import { getSummary } from "../services/api";

/* ═══════════════════════════════════════════════════════════
   UTILITY
═══════════════════════════════════════════════════════════ */
const norm = (s = "") =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/* Find best-matching node for a free-text phrase */
function matchNode(text, nodes) {
  const t = norm(text);

  // 1. exact id match
  for (const n of nodes) {
    if (t.includes(norm(n.id))) return n;
  }

  // 2. alias match — check every alias string
  for (const n of nodes) {
    if (!n.aliases) continue;
    for (const alias of n.aliases) {
      if (t.includes(norm(alias))) return n;
    }
  }

  // 3. label word-overlap score
  let best = null, bestScore = 0;
  for (const n of nodes) {
    const words = norm(n.label.replace(/\n/g, " "))
      .split(" ")
      .filter(w => w.length > 2);
    const hits  = words.filter(w => t.includes(w));
    const score = words.length ? hits.length / words.length : 0;
    if (score > bestScore && score >= 0.25) {
      bestScore = score;
      best = n;
    }
  }

  // 4. alias word-overlap score (catches partial alias matches)
  for (const n of nodes) {
    if (!n.aliases) continue;
    for (const alias of n.aliases) {
      const words = norm(alias).split(" ").filter(w => w.length > 2);
      const hits  = words.filter(w => t.includes(w));
      const score = words.length ? hits.length / words.length : 0;
      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        best = n;
      }
    }
  }

  return best;
}

/* Friendly display label */
const lbl = (n) => n.label.replace(/\n/g, " ");

/* ═══════════════════════════════════════════════════════════
   LOCAL CHATBOT BRAIN
   Returns { text, nodeToOpen? }
═══════════════════════════════════════════════════════════ */
async function getBotResponse(userText, nodes, selectedNode) {
  const t = norm(userText);

  /* ── greet ── */
  if (/^(hi|hello|hey|good\s*(morning|evening|afternoon)|howdy)/.test(t)) {
    return {
      text:
        "👋 Hello! I'm your Rapid Dashboard assistant.\n\n" +
        "I can help you with:\n" +
        "• Success, failed & total counts for any node\n" +
        "• Compare two nodes side by side\n" +
        "• Find the node with most failures\n" +
        "• Navigate to any node\n" +
        "• Overall summary of all nodes\n\n" +
        "Type **help** to see all commands.",
    };
  }

  /* ── help ── */
  if (
    t.includes("help") ||
    t.includes("what can you") ||
    t.includes("commands") ||
    t.includes("what do you")
  ) {
    return {
      text:
        "📖 **Commands you can use:**\n\n" +
        "• **list nodes** — show all available nodes\n" +
        "• **total for [node]** — total transaction count\n" +
        "• **failed in [node]** — failed count + %\n" +
        "• **success in [node]** — success count + %\n" +
        "• **open [node]** — navigate to that node\n" +
        "• **compare [node] and [node]** — side-by-side stats\n" +
        "• **which node has most failures** — worst node\n" +
        "• **which node has most success** — best node\n" +
        "• **overall summary** — all nodes at once\n" +
        "• **current node** — stats for selected node\n\n" +
        "You can also just type a node name and I'll show its stats!",
    };
  }

  /* ── list nodes ── */
  if (
    t.includes("list") ||
    t.includes("all node") ||
    t.includes("available node") ||
    t.includes("what node") ||
    t.includes("show node")
  ) {
    const list = nodes
      .map((n, i) => `${i + 1}. ${lbl(n)}`)
      .join("\n");
    return {
      text: `📋 **There are ${nodes.length} nodes:**\n\n${list}`,
    };
  }

  /* ── overall summary ── */
  if (
    (t.includes("overall") ||
      t.includes("all node") ||
      t.includes("everything") ||
      t.includes("full summary") ||
      t.includes("all summary")) &&
    (t.includes("summary") ||
      t.includes("total") ||
      t.includes("status") ||
      t.includes("overview") ||
      t.includes("report"))
  ) {
    try {
      const results = await Promise.all(
        nodes.map(n =>
          getSummary(n.id)
            .then(s => ({ n, s }))
            .catch(() => ({ n, s: { total: 0, success: 0, failed: 0 } }))
        )
      );
      let grandTotal = 0, grandSuccess = 0, grandFailed = 0;
      const lines = results.map(({ n, s }) => {
        grandTotal   += s.total   || 0;
        grandSuccess += s.success || 0;
        grandFailed  += s.failed  || 0;
        const pct = s.total
          ? Math.round(((s.failed || 0) / s.total) * 100)
          : 0;
        return `• **${lbl(n)}**\n  Total: ${(s.total||0).toLocaleString()} | ✅ ${(s.success||0).toLocaleString()} | ❌ ${(s.failed||0).toLocaleString()} (${pct}% fail)`;
      });
      return {
        text:
          `📊 **Overall Summary — All Nodes**\n\n` +
          `${lines.join("\n\n")}\n\n` +
          `──────────────────\n` +
          `**Grand Total: ${grandTotal.toLocaleString()}**\n` +
          `✅ Success: ${grandSuccess.toLocaleString()}\n` +
          `❌ Failed: ${grandFailed.toLocaleString()}`,
      };
    } catch {
      return { text: "❌ Could not fetch data. Is the backend running on port 5000?" };
    }
  }

  /* ── which node has most failures ── */
  if (
    t.includes("most fail") ||
    t.includes("highest fail") ||
    t.includes("worst node") ||
    t.includes("most error") ||
    t.includes("most problem")
  ) {
    try {
      const results = await Promise.all(
        nodes.map(n =>
          getSummary(n.id)
            .then(s => ({ n, s }))
            .catch(() => ({ n, s: { failed: 0, total: 0 } }))
        )
      );
      const worst = results.reduce((a, b) =>
        (b.s.failed || 0) > (a.s.failed || 0) ? b : a
      );
      const pct = worst.s.total
        ? Math.round(((worst.s.failed || 0) / worst.s.total) * 100)
        : 0;
      return {
        text:
          `🔴 **${lbl(worst.n)}** has the most failures.\n\n` +
          `• Total: ${(worst.s.total||0).toLocaleString()}\n` +
          `• ❌ Failed: ${(worst.s.failed||0).toLocaleString()} (${pct}%)\n` +
          `• ✅ Success: ${(worst.s.success||0).toLocaleString()}`,
      };
    } catch {
      return { text: "❌ Could not fetch data. Is the backend running?" };
    }
  }

  /* ── which node has most success ── */
  if (
    t.includes("most success") ||
    t.includes("best node") ||
    t.includes("highest success") ||
    t.includes("most pass")
  ) {
    try {
      const results = await Promise.all(
        nodes.map(n =>
          getSummary(n.id)
            .then(s => ({ n, s }))
            .catch(() => ({ n, s: { success: 0, total: 0 } }))
        )
      );
      const best = results.reduce((a, b) =>
        (b.s.success || 0) > (a.s.success || 0) ? b : a
      );
      const pct = best.s.total
        ? Math.round(((best.s.success || 0) / best.s.total) * 100)
        : 0;
      return {
        text:
          `🟢 **${lbl(best.n)}** has the most successes.\n\n` +
          `• Total: ${(best.s.total||0).toLocaleString()}\n` +
          `• ✅ Success: ${(best.s.success||0).toLocaleString()} (${pct}%)\n` +
          `• ❌ Failed: ${(best.s.failed||0).toLocaleString()}`,
      };
    } catch {
      return { text: "❌ Could not fetch data. Is the backend running?" };
    }
  }

  /* ── compare two nodes ── */
  if (
    t.includes("compare") ||
    t.includes(" vs ") ||
    t.includes("versus") ||
    t.includes("difference between")
  ) {
    const matched = nodes.filter(n => {
      const words = norm(lbl(n)).split(" ").filter(w => w.length > 2);
      return words.some(w => t.includes(w));
    });
    if (matched.length >= 2) {
      try {
        const [a, b]   = matched;
        const [sa, sb] = await Promise.all([getSummary(a.id), getSummary(b.id)]);
        const betterLabel =
          (sa.failed || 0) <= (sb.failed || 0) ? lbl(a) : lbl(b);
        const diff = Math.abs((sa.failed || 0) - (sb.failed || 0));
        return {
          text:
            `📊 **Comparison**\n\n` +
            `**${lbl(a)}**\n` +
            `  Total: ${(sa.total||0).toLocaleString()} | ✅ ${(sa.success||0).toLocaleString()} | ❌ ${(sa.failed||0).toLocaleString()}\n\n` +
            `**${lbl(b)}**\n` +
            `  Total: ${(sb.total||0).toLocaleString()} | ✅ ${(sb.success||0).toLocaleString()} | ❌ ${(sb.failed||0).toLocaleString()}\n\n` +
            `💡 **${betterLabel}** has fewer failures by **${diff.toLocaleString()}**.`,
        };
      } catch {
        return { text: "❌ Could not fetch data. Is the backend running?" };
      }
    }
    return {
      text:
        "Please name two nodes to compare.\n\n" +
        'Example: "compare WMS replication and SAP delivery"',
    };
  }

  /* ── current / selected node ── */
  if (
    (t.includes("current") ||
      t.includes("this node") ||
      t.includes("selected")) &&
    (t.includes("status") ||
      t.includes("summary") ||
      t.includes("total") ||
      t.includes("fail") ||
      t.includes("success"))
  ) {
    if (!selectedNode) {
      return {
        text: "No node is currently selected.\nClick a circle on the diagram or say \"open [node name]\".",
      };
    }
    try {
      const s   = await getSummary(selectedNode);
      const pct = s.total
        ? Math.round(((s.failed || 0) / s.total) * 100)
        : 0;
      const node = nodes.find(n => n.id === selectedNode);
      return {
        text:
          `📍 **${node ? lbl(node) : selectedNode}** (currently selected)\n\n` +
          `• Total: ${(s.total||0).toLocaleString()}\n` +
          `• ✅ Success: ${(s.success||0).toLocaleString()}\n` +
          `• ❌ Failed: ${(s.failed||0).toLocaleString()}\n` +
          `• Failure rate: ${pct}%`,
      };
    } catch {
      return { text: "❌ Could not fetch data. Is the backend running?" };
    }
  }

  /* ── open / navigate ── */
  if (
    t.includes("open") ||
    t.includes("show me") ||
    t.includes("navigate") ||
    t.includes("go to") ||
    t.includes("take me") ||
    t.includes("load")
  ) {
    const n = matchNode(userText, nodes);
    if (n) {
      try {
        const s   = await getSummary(n.id);
        const pct = s.total
          ? Math.round(((s.failed || 0) / s.total) * 100)
          : 0;
        return {
          text:
            `🔀 Opening **${lbl(n)}**\n\n` +
            `• Total: ${(s.total||0).toLocaleString()}\n` +
            `• ✅ Success: ${(s.success||0).toLocaleString()}\n` +
            `• ❌ Failed: ${(s.failed||0).toLocaleString()}\n` +
            `• Failure rate: ${pct}%`,
          nodeToOpen: n.id,
        };
      } catch {
        return {
          text: `Opening **${lbl(n)}**…`,
          nodeToOpen: n.id,
        };
      }
    }
    return {
      text:
        "I couldn't find that node.\nType **list nodes** to see all available nodes.",
    };
  }

  /* ── failed count ── */
  if (
    t.includes("fail") ||
    t.includes("error") ||
    t.includes("issue") ||
    t.includes("problem")
  ) {
    const n = matchNode(userText, nodes);
    if (n) {
      try {
        const s   = await getSummary(n.id);
        const pct = s.total
          ? Math.round(((s.failed || 0) / s.total) * 100)
          : 0;
        return {
          text:
            `❌ **${lbl(n)}** — Failed Transactions\n\n` +
            `• Failed: **${(s.failed||0).toLocaleString()}** (${pct}%)\n` +
            `• Success: ${(s.success||0).toLocaleString()}\n` +
            `• Total: ${(s.total||0).toLocaleString()}`,
        };
      } catch {
        return { text: "❌ Could not fetch data. Is the backend running?" };
      }
    }
    // no specific node — show all
    try {
      const results = await Promise.all(
        nodes.map(n =>
          getSummary(n.id)
            .then(s => ({ n, s }))
            .catch(() => ({ n, s: { failed: 0, total: 0 } }))
        )
      );
      const lines = results.map(({ n, s }) => {
        const pct = s.total
          ? Math.round(((s.failed || 0) / s.total) * 100)
          : 0;
        return `• **${lbl(n)}**: ❌ ${(s.failed||0).toLocaleString()} (${pct}%)`;
      });
      return {
        text: `❌ **Failed counts — all nodes:**\n\n${lines.join("\n")}`,
      };
    } catch {
      return { text: "❌ Could not fetch data. Is the backend running?" };
    }
  }

  /* ── success count ── */
  if (
    t.includes("success") ||
    t.includes("passed") ||
    t.includes("completed") ||
    t.includes("done")
  ) {
    const n = matchNode(userText, nodes);
    if (n) {
      try {
        const s   = await getSummary(n.id);
        const pct = s.total
          ? Math.round(((s.success || 0) / s.total) * 100)
          : 0;
        return {
          text:
            `✅ **${lbl(n)}** — Successful Transactions\n\n` +
            `• Success: **${(s.success||0).toLocaleString()}** (${pct}%)\n` +
            `• Failed: ${(s.failed||0).toLocaleString()}\n` +
            `• Total: ${(s.total||0).toLocaleString()}`,
        };
      } catch {
        return { text: "❌ Could not fetch data. Is the backend running?" };
      }
    }
    try {
      const results = await Promise.all(
        nodes.map(n =>
          getSummary(n.id)
            .then(s => ({ n, s }))
            .catch(() => ({ n, s: { success: 0, total: 0 } }))
        )
      );
      const lines = results.map(({ n, s }) => {
        const pct = s.total
          ? Math.round(((s.success || 0) / s.total) * 100)
          : 0;
        return `• **${lbl(n)}**: ✅ ${(s.success||0).toLocaleString()} (${pct}%)`;
      });
      return {
        text: `✅ **Success counts — all nodes:**\n\n${lines.join("\n")}`,
      };
    } catch {
      return { text: "❌ Could not fetch data. Is the backend running?" };
    }
  }

  /* ── total / count ── */
  if (
    t.includes("total") ||
    t.includes("count") ||
    t.includes("how many") ||
    t.includes("number of") ||
    t.includes("how much")
  ) {
    const n = matchNode(userText, nodes);
    if (n) {
      try {
        const s = await getSummary(n.id);
        return {
          text:
            `📊 **${lbl(n)}** — Total Transactions\n\n` +
            `• Total: **${(s.total||0).toLocaleString()}**\n` +
            `• ✅ Success: ${(s.success||0).toLocaleString()}\n` +
            `• ❌ Failed: ${(s.failed||0).toLocaleString()}`,
        };
      } catch {
        return { text: "❌ Could not fetch data. Is the backend running?" };
      }
    }
  }

  /* ── catch-all: just a node name typed ── */
  const n = matchNode(userText, nodes);
  if (n) {
    try {
      const s   = await getSummary(n.id);
      const pct = s.total
        ? Math.round(((s.failed || 0) / s.total) * 100)
        : 0;
      return {
        text:
          `📊 **${lbl(n)}**\n\n` +
          `• Total: ${(s.total||0).toLocaleString()}\n` +
          `• ✅ Success: ${(s.success||0).toLocaleString()}\n` +
          `• ❌ Failed: ${(s.failed||0).toLocaleString()}\n` +
          `• Failure rate: ${pct}%`,
        nodeToOpen: n.id,
      };
    } catch {
      return { text: "❌ Could not fetch data. Is the backend running?" };
    }
  }

  /* ── thank you ── */
  if (
    t.includes("thank") ||
    t.includes("thanks") ||
    t.includes("great") ||
    t.includes("awesome") ||
    t.includes("good job")
  ) {
    return { text: "😊 You're welcome! Let me know if you need anything else." };
  }

  /* ── bye ── */
  if (
    t.includes("bye") ||
    t.includes("goodbye") ||
    t.includes("see you") ||
    t.includes("exit")
  ) {
    return { text: "👋 Goodbye! Come back anytime." };
  }

  /* ── fallback ── */
  return {
    text:
      "I'm not sure about that. Here are some things to try:\n\n" +
      '• "failed in WMS replication"\n' +
      '• "total for SAP delivery"\n' +
      '• "compare cop hop and och hop"\n' +
      '• "which node has most failures"\n' +
      '• "overall summary"\n' +
      '• "list nodes"\n\n' +
      "Type **help** for all commands.",
  };
}

/* ═══════════════════════════════════════════════════════════
   RENDER TEXT  — supports **bold** and \n line breaks
═══════════════════════════════════════════════════════════ */
function RenderText({ text }) {
  return (
    <span>
      {text.split("\n").map((line, i, arr) => {
        const parts = line.split(/\*\*(.+?)\*\*/g);
        return (
          <span key={i}>
            {parts.map((p, j) =>
              j % 2 === 1 ? <strong key={j}>{p}</strong> : p
            )}
            {i < arr.length - 1 && <br />}
          </span>
        );
      })}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════
   COMPONENT
═══════════════════════════════════════════════════════════ */
export default function FloatingAssistant({
  nodesConfig,
  summaryMap,
  selectedNode,
  currentSummary,
  onNodeSelect,
}) {
  const [open,         setOpen]         = useState(false);
  const [tab,          setTab]          = useState("chat");

  /* voice */
  const [listening,    setListening]    = useState(false);
  const [transcript,   setTranscript]   = useState("");
  const [voiceReply,   setVoiceReply]   = useState("");
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [sttSupported, setSttSupported] = useState(true);
  const recognitionRef = useRef(null);
  const synthRef       = useRef(window.speechSynthesis);

  /* chat */
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text:
        "👋 Hi! I'm your Rapid Dashboard assistant.\n\n" +
        "Try asking:\n" +
        '• "failed in WMS replication"\n' +
        '• "compare SAP delivery and cop hop"\n' +
        '• "overall summary"\n' +
        '• "which node has most failures"\n\n' +
        "Type **help** for all commands.",
    },
  ]);
  const [input,       setInput]       = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  /* ── init STT ── */
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSttSupported(false); return; }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let interim = "", final = "";
      for (const r of e.results) {
        if (r.isFinal) final   += r[0].transcript;
        else           interim += r[0].transcript;
      }
      setTranscript(final || interim);
      if (final) handleVoiceCommand(final);
    };
    rec.onend   = () => setListening(false);
    rec.onerror = (e) => {
      setListening(false);
      setVoiceReply("Mic error: " + e.error);
    };
    recognitionRef.current = rec;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── scroll chat to bottom ── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ── speak helper ── */
  const speak = useCallback((text) => {
    const synth = synthRef.current;
    if (!synth) return;
    synth.cancel();
    const plain = text
      .replace(/\*\*/g, "")
      .replace(/[📊✅❌📋📍🔀🟢🔴😊👋🔵]/g, "");
    const utt = new SpeechSynthesisUtterance(plain);
    utt.rate = 1; utt.pitch = 1; utt.volume = 1;
    const voices = synth.getVoices();
    const v = voices.find(v => v.name.includes("Google") || v.lang === "en-US");
    if (v) utt.voice = v;
    synth.speak(utt);
    setVoiceReply(plain.slice(0, 200));
  }, []);

  /* ── voice command handler ── */
  const handleVoiceCommand = useCallback(
    async (text) => {
      const t = norm(text);

      if (t.includes("stop") || t.includes("close")) {
        speak("Stopped."); return;
      }
      if (t.includes("list") || t.includes("available")) {
        speak(
          "Available nodes: " +
          nodesConfig.map(n => n.label.replace(/\n/g, " ")).join(", ")
        );
        return;
      }
      if (
        t.includes("how many") ||
        t.includes("summary") ||
        t.includes("status")
      ) {
        if (!selectedNode) {
          speak("Please open a node first."); return;
        }
        setVoiceLoading(true);
        try {
          const s   = await getSummary(selectedNode);
          const lbl = nodesConfig.find(n => n.id === selectedNode)
            ?.label.replace(/\n/g, " ") || selectedNode;
          speak(
            `${lbl}: total ${(s.total??0).toLocaleString()}, ` +
            `success ${(s.success??0).toLocaleString()}, ` +
            `failed ${(s.failed??0).toLocaleString()}.`
          );
        } catch { speak("Could not fetch data."); }
        setVoiceLoading(false);
        return;
      }

      /* match a node */
      const matched = matchNode(text, nodesConfig);
      if (matched) {
        setVoiceLoading(true);
        try {
          const s = await getSummary(matched.id);
          speak(
            `Opening ${lbl(matched)}. ` +
            `Total: ${(s.total??0).toLocaleString()}, ` +
            `Success: ${(s.success??0).toLocaleString()}, ` +
            `Failed: ${(s.failed??0).toLocaleString()}.`
          );
          onNodeSelect(matched.id);
        } catch {
          speak(`Opening ${lbl(matched)}.`);
          onNodeSelect(matched.id);
        }
        setVoiceLoading(false);
      } else {
        speak(
          `No match for "${text}". Try saying a node name like WMS replication or SAP delivery.`
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodesConfig, selectedNode, onNodeSelect, speak]
  );

  /* ── toggle mic ── */
  const toggleMic = () => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) { rec.stop(); setListening(false); }
    else {
      setTranscript(""); setVoiceReply("");
      try { rec.start(); setListening(true); } catch (e) { console.error(e); }
    }
  };

  /* ── send chat message (fully local) ── */
  const sendChat = useCallback(async () => {
    const text = input.trim();
    if (!text || chatLoading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", text }]);
    setChatLoading(true);
    const response = await getBotResponse(text, nodesConfig, selectedNode);
    setMessages(prev => [...prev, { role: "assistant", text: response.text }]);
    if (response.nodeToOpen) onNodeSelect(response.nodeToOpen);
    setChatLoading(false);
  }, [input, chatLoading, nodesConfig, selectedNode, onNodeSelect]);

  /* ── render ── */
  return (
    <div className="fa-root">
      {open && (
        <div className="fa-panel">
          {/* header */}
          <div className="fa-panel-header">
            <div className="fa-tabs">
              <button
                className={`fa-tab ${tab === "chat" ? "fa-tab--active" : ""}`}
                onClick={() => setTab("chat")}
              >
                🤖 Chat
              </button>
              <button
                className={`fa-tab ${tab === "voice" ? "fa-tab--active" : ""}`}
                onClick={() => setTab("voice")}
              >
                🎤 Voice
              </button>
            </div>
            <button className="fa-close-btn" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>

          {/* ── CHAT TAB ── */}
          {tab === "chat" && (
            <div className="fa-chat">
              <div className="fa-messages">
                {messages.map((m, i) => (
                  <div key={i} className={`fa-msg fa-msg--${m.role}`}>
                    {m.role === "assistant" && (
                      <span className="fa-msg-avatar">🤖</span>
                    )}
                    <div className="fa-msg-bubble">
                      <RenderText text={m.text} />
                    </div>
                    {m.role === "user" && (
                      <span className="fa-msg-avatar">👤</span>
                    )}
                  </div>
                ))}
                {chatLoading && (
                  <div className="fa-msg fa-msg--assistant">
                    <span className="fa-msg-avatar">🤖</span>
                    <div className="fa-msg-bubble fa-typing">
                      <span /><span /><span />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="fa-input-row">
                <input
                  className="fa-input"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && sendChat()}
                  placeholder='Try "failed in WMS replication"'
                  disabled={chatLoading}
                />
                <button
                  className="fa-send-btn"
                  onClick={sendChat}
                  disabled={chatLoading}
                >
                  ➤
                </button>
              </div>
            </div>
          )}

          {/* ── VOICE TAB ── */}
          {tab === "voice" && (
            <div className="fa-voice">
              {!sttSupported ? (
                <div className="fa-unsupported">
                  ⚠️ Voice not supported. Use Chrome or Edge.
                </div>
              ) : (
                <>
                  <button
                    className={`fa-mic-big ${listening ? "fa-mic-big--active" : ""} ${voiceLoading ? "fa-mic-big--loading" : ""}`}
                    onClick={toggleMic}
                    disabled={voiceLoading}
                  >
                    <span className="fa-mic-icon">
                      {voiceLoading ? "⏳" : listening ? "⏹" : "🎤"}
                    </span>
                    <span className="fa-mic-label">
                      {voiceLoading
                        ? "Fetching data…"
                        : listening
                        ? "Listening… tap to stop"
                        : "Tap to speak"}
                    </span>
                    {listening && !voiceLoading && <span className="fa-pulse" />}
                  </button>

                  {transcript && (
                    <div className="fa-voice-row">
                      <div className="fa-voice-label">You said</div>
                      <div className="fa-voice-text">{transcript}</div>
                    </div>
                  )}
                  {voiceReply && (
                    <div className="fa-voice-row">
                      <div className="fa-voice-label">Assistant replied</div>
                      <div className="fa-voice-text fa-voice-reply">
                        {voiceReply}
                      </div>
                    </div>
                  )}

                  <div className="fa-hints">
                    <strong>Try saying:</strong>
                    <br />
                    "open WMS replication"
                    <br />
                    "how many failed in SAP delivery"
                    <br />
                    "list nodes"
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* FAB button */}
      <button
        className={`fa-fab ${open ? "fa-fab--open" : ""} ${listening ? "fa-fab--listening" : ""}`}
        onClick={() => setOpen(o => !o)}
        title="Open Assistant"
      >
        {listening ? "🎤" : open ? "✕" : "💬"}
      </button>
    </div>
  );
}
