import { useState, useCallback, useRef, useEffect, useMemo } from "react";

const DEFAULT_CONFIG = {
  start_patterns: ["cmd_from_mockapp", "REQUEST OPEN SERVER"],
  end_patterns: ["Process Finished!"],
  success_patterns: ["result_code=success"],
  failure_patterns: ["result_code=fail"],
  clickable_patterns: {
    conversationId: {
      pattern: "conversationId\\[([^\\]]+)\\]",
      url_template: "https://sumologic.bixbydev.com/stg/conversation/?conversationId={value}",
      display_name: "ConversationID",
    },
    requestId: {
      pattern: "requestId\\[([^\\]]+)\\]",
      url_template: null,
      display_name: "RequestID",
    },
  },
  utterance_patterns: {
    cmd_from_mockapp: {
      pattern: "cmd_from_mockapp, ([^\\]]+)",
      utterance: "{value}",
    },
    kAsr2Response: {
      pattern: "kAsr2Response \\[FINAL\\] \\[([^\\]]+)\\]",
      utterance: "{value}",
    },
  },
  pattern_groups: {
    MakeMetaDataParams: {
      name: "MakeMetaDataParams",
      patterns: ["MakeMetaDataParams.*"],
    },
    Actions: {
      name: "Action",
      patterns: ["result_code"],
    },
  },
};

/* ── Utility: parse one block of valid logs ── */
function parseBlock(lines, config) {
  const entry = {
    id: crypto.randomUUID(),
    conversationId: null,
    requestId: null,
    utterance: null,
    result: "Unknown",
    successLine: null,
    failLines: [],
    allLines: lines,
    patternGroups: {},
  };

  // Extract clickable values
  for (const [key, cfg] of Object.entries(config.clickable_patterns)) {
    const re = new RegExp(cfg.pattern);
    for (const l of lines) {
      const m = l.match(re);
      if (m) {
        entry[key] = m[1];
        break;
      }
    }
  }

  // Extract utterance
  for (const [, cfg] of Object.entries(config.utterance_patterns)) {
    const re = new RegExp(cfg.pattern);
    for (const l of lines) {
      const m = l.match(re);
      if (m) {
        entry.utterance = cfg.utterance.replace("{value}", m[1].trim());
        break;
      }
    }
    if (entry.utterance) break;
  }

  // Determine success/fail
  let hasSuccess = false;
  let hasFail = false;
  for (const l of lines) {
    for (const sp of config.success_patterns) {
      if (l.includes(sp)) {
        hasSuccess = true;
        entry.successLine = l;
      }
    }
    if (config.failure_patterns) {
      for (const fp of config.failure_patterns) {
        if (l.includes(fp)) {
          hasFail = true;
          entry.failLines.push(l);
        }
      }
    }
  }

  if (hasSuccess && !hasFail) entry.result = "SUCCESS";
  else if (hasSuccess && hasFail) entry.result = "PARTIAL";
  else if (!hasSuccess && hasFail) entry.result = "FAIL";
  else entry.result = "Unknown";

  // Pattern groups
  for (const [gKey, gCfg] of Object.entries(config.pattern_groups)) {
    const matched = [];
    for (const l of lines) {
      for (const p of gCfg.patterns) {
        if (new RegExp(p).test(l)) {
          matched.push(l);
          break;
        }
      }
    }
    if (matched.length > 0) {
      entry.patternGroups[gKey] = { name: gCfg.name, lines: matched };
    }
  }

  return entry;
}

/* ── Streaming parser ── */
function streamParse(text, config, onEntry) {
  const lines = text.split("\n");
  let buffer = [];
  let inBlock = false;

  const startREs = config.start_patterns.map((p) => new RegExp(p));
  const endREs = config.end_patterns.map((p) => new RegExp(p));

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isStart = startREs.some((re) => re.test(trimmed));
    const isEnd = endREs.some((re) => re.test(trimmed));

    if (isStart && !inBlock) {
      buffer = [trimmed];
      inBlock = true;
    } else if (isEnd && inBlock) {
      buffer.push(trimmed);
      onEntry(parseBlock(buffer, config));
      buffer = [];
      inBlock = false;
    } else if (inBlock) {
      buffer.push(trimmed);
    }
  }
}

/* ── Clickable log line component ── */
function LogLine({ line, config }) {
  const parts = [];
  let remaining = line;
  let key = 0;

  for (const [, cfg] of Object.entries(config.clickable_patterns)) {
    const re = new RegExp(cfg.pattern, "g");
    let m;
    let lastIdx = 0;
    const segs = [];
    const tmpRemaining = remaining;
    while ((m = re.exec(tmpRemaining)) !== null) {
      if (m.index > lastIdx) {
        segs.push({ type: "text", text: tmpRemaining.slice(lastIdx, m.index) });
      }
      segs.push({ type: "link", full: m[0], value: m[1], cfg });
      lastIdx = m.index + m[0].length;
    }
    if (segs.length > 0) {
      if (lastIdx < tmpRemaining.length) {
        segs.push({ type: "text", text: tmpRemaining.slice(lastIdx) });
      }
      for (const s of segs) {
        if (s.type === "text") {
          parts.push(<span key={key++}>{s.text}</span>);
        } else {
          if (s.cfg.url_template) {
            const url = s.cfg.url_template.replace("{value}", s.value);
            parts.push(
              <a
                key={key++}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "#60dcfa",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
                title={`${s.cfg.display_name}: ${s.value}`}
              >
                {s.full}
              </a>
            );
          } else {
            parts.push(
              <span
                key={key++}
                style={{ color: "#a8e6cf", fontWeight: 600 }}
                title={`${s.cfg.display_name}: ${s.value}`}
              >
                {s.full}
              </span>
            );
          }
        }
      }
      remaining = null;
      break;
    }
  }

  if (remaining !== null) {
    parts.push(<span key={key++}>{remaining}</span>);
  }

  return <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, lineHeight: "20px", padding: "1px 0", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{parts}</div>;
}

/* ── Badge ── */
function Badge({ result }) {
  const colors = {
    SUCCESS: { bg: "#0d3b24", text: "#34d399", border: "#166534" },
    FAIL: { bg: "#3b0d0d", text: "#f87171", border: "#7f1d1d" },
    PARTIAL: { bg: "#3b2e0d", text: "#fbbf24", border: "#78350f" },
    Unknown: { bg: "#1e1e2e", text: "#94a3b8", border: "#334155" },
  };
  const c = colors[result] || colors.Unknown;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "'IBM Plex Mono', monospace",
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        letterSpacing: 0.5,
      }}
    >
      {result}
    </span>
  );
}

/* ── Sort icon ── */
function SortIcon({ active, dir }) {
  if (!active) return <span style={{ opacity: 0.25, marginLeft: 4, fontSize: 10 }}>⇅</span>;
  return <span style={{ marginLeft: 4, fontSize: 10, color: "#60dcfa" }}>{dir === "asc" ? "↑" : "↓"}</span>;
}

/* ── Detail Modal ── */
function DetailView({ entry, config, onClose }) {
  if (!entry) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "40px 20px",
        overflowY: "auto",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0f1117",
          border: "1px solid #1e2433",
          borderRadius: 12,
          width: "100%",
          maxWidth: 1100,
          padding: 0,
          boxShadow: "0 25px 80px rgba(0,0,0,0.6)",
          animation: "slideUp 0.25s ease-out",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px 28px", borderBottom: "1px solid #1e2433", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", fontFamily: "'Space Grotesk', sans-serif" }}>
              Utterance Detail
            </div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
              {entry.utterance || "N/A"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "#1e2433",
              border: "none",
              color: "#94a3b8",
              fontSize: 18,
              cursor: "pointer",
              borderRadius: 8,
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: "20px 28px" }}>
          {/* Meta cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 24 }}>
            {[
              { label: "Conversation ID", value: entry.conversationId },
              { label: "Request ID", value: entry.requestId },
              { label: "Utterance", value: entry.utterance },
              { label: "Result", value: entry.result, isBadge: true },
            ].map((item, i) => (
              <div key={i} style={{ background: "#161b26", borderRadius: 8, padding: "12px 16px", border: "1px solid #1e2433" }}>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 4 }}>{item.label}</div>
                {item.isBadge ? <Badge result={item.value} /> : (
                  <div style={{ fontSize: 13, color: "#e2e8f0", fontFamily: "'IBM Plex Mono', monospace", wordBreak: "break-all" }}>{item.value || "N/A"}</div>
                )}
              </div>
            ))}
          </div>

          {/* Success line */}
          {entry.successLine && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: "#34d399", fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>✓ Success Match</div>
              <div style={{ background: "#0d3b24", border: "1px solid #166534", borderRadius: 6, padding: "8px 12px" }}>
                <LogLine line={entry.successLine} config={config} />
              </div>
            </div>
          )}

          {/* Fail lines */}
          {entry.failLines.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: "#f87171", fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>✗ Failure Matches</div>
              <div style={{ background: "#3b0d0d", border: "1px solid #7f1d1d", borderRadius: 6, padding: "8px 12px" }}>
                {entry.failLines.map((l, i) => <LogLine key={i} line={l} config={config} />)}
              </div>
            </div>
          )}

          {/* Pattern Groups */}
          {Object.keys(entry.patternGroups).length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: "#60dcfa", fontWeight: 700, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Pattern Groups</div>
              {Object.entries(entry.patternGroups).map(([gKey, g]) => (
                <div key={gKey} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "#a78bfa", fontWeight: 600, marginBottom: 4, background: "#1e1640", display: "inline-block", padding: "2px 10px", borderRadius: 4 }}>
                    {g.name}
                  </div>
                  <div style={{ background: "#161b26", border: "1px solid #1e2433", borderRadius: 6, padding: "8px 12px", maxHeight: 200, overflowY: "auto" }}>
                    {g.lines.map((l, i) => <LogLine key={i} line={l} config={config} />)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* All valid logs */}
          <div>
            <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>All Valid Logs ({entry.allLines.length} lines)</div>
            <div style={{
              background: "#0a0d14",
              border: "1px solid #1e2433",
              borderRadius: 6,
              padding: "10px 14px",
              maxHeight: 400,
              overflowY: "auto",
              counterReset: "line",
            }}>
              {entry.allLines.map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 10 }}>
                  <span style={{ color: "#334155", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", minWidth: 30, textAlign: "right", userSelect: "none" }}>{i + 1}</span>
                  <LogLine line={l} config={config} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main App ── */
export default function App() {
  const [config] = useState(DEFAULT_CONFIG);
  const [entries, setEntries] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [fileName, setFileName] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const fileInputRef = useRef(null);
  const [totalLines, setTotalLines] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const processText = useCallback(
    (text, name) => {
      setEntries([]);
      setParsing(true);
      setFileName(name || "clipboard");
      setTotalLines(text.split("\n").length);

      // Use chunked processing to simulate streaming for large files
      const CHUNK = 50000;
      const lines = text.split("\n");
      let idx = 0;

      function processChunk() {
        const chunkLines = lines.slice(idx, idx + CHUNK);
        const chunkText = chunkLines.join("\n");
        const newEntries = [];
        streamParse(chunkText, config, (e) => newEntries.push(e));
        if (newEntries.length > 0) {
          setEntries((prev) => [...prev, ...newEntries]);
        }
        idx += CHUNK;
        if (idx < lines.length) {
          requestAnimationFrame(processChunk);
        } else {
          setParsing(false);
        }
      }

      requestAnimationFrame(processChunk);
    },
    [config]
  );

  // File handling
  const handleFile = useCallback(
    (file) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => processText(e.target.result, file.name);
      reader.readAsText(file);
    },
    [processText]
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  // Clipboard paste
  useEffect(() => {
    const handler = (e) => {
      const text = e.clipboardData?.getData("text");
      if (text && text.length > 10) {
        e.preventDefault();
        processText(text, "clipboard-paste");
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [processText]);

  const handlePasteBtn = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) processText(text, "clipboard-paste");
    } catch {
      alert("Clipboard access denied. Use Ctrl+V instead.");
    }
  }, [processText]);

  // Sort & filter
  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const filteredEntries = useMemo(() => {
    let result = entries;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      result = result.filter(
        (e) =>
          (e.conversationId || "").toLowerCase().includes(q) ||
          (e.requestId || "").toLowerCase().includes(q) ||
          (e.utterance || "").toLowerCase().includes(q) ||
          e.result.toLowerCase().includes(q) ||
          (e.successLine || "").toLowerCase().includes(q)
      );
    }
    if (sortCol) {
      result = [...result].sort((a, b) => {
        const va = (a[sortCol] || "").toString().toLowerCase();
        const vb = (b[sortCol] || "").toString().toLowerCase();
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }
    return result;
  }, [entries, searchTerm, sortCol, sortDir]);

  const columns = [
    { key: "conversationId", label: "Conversation ID", width: "20%" },
    { key: "requestId", label: "Request ID", width: "12%" },
    { key: "utterance", label: "Utterance", width: "28%" },
    { key: "result", label: "Result", width: "10%" },
    { key: "successLine", label: "Success Match", width: "30%" },
  ];

  const stats = useMemo(() => {
    const s = { total: entries.length, success: 0, fail: 0, partial: 0, unknown: 0 };
    for (const e of entries) {
      if (e.result === "SUCCESS") s.success++;
      else if (e.result === "FAIL") s.fail++;
      else if (e.result === "PARTIAL") s.partial++;
      else s.unknown++;
    }
    return s;
  }, [entries]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#080a10",
        color: "#e2e8f0",
        fontFamily: "'DM Sans', 'Pretendard', sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0f1117; }
        ::-webkit-scrollbar-thumb { background: #2a3040; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #3a4050; }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1e2433",
        background: "linear-gradient(180deg, #0f1219 0%, #080a10 100%)",
        padding: "16px 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #60dcfa 0%, #a78bfa 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 700, color: "#080a10",
          }}>B</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: -0.3 }}>
              Bixby Log Analyzer
            </div>
            <div style={{ fontSize: 11, color: "#4a5568" }}>Voice Interaction Report</div>
          </div>
        </div>
        {fileName && (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              <span style={{ color: "#60dcfa" }}>{fileName}</span> · {totalLines.toLocaleString()} lines · {entries.length} utterances
              {parsing && <span style={{ color: "#fbbf24", animation: "pulse 1s infinite", marginLeft: 8 }}>● Parsing...</span>}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
        {/* Drop zone / Upload area */}
        {entries.length === 0 && !parsing ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? "#60dcfa" : "#1e2433"}`,
              borderRadius: 16,
              padding: "80px 40px",
              textAlign: "center",
              cursor: "pointer",
              background: dragOver ? "rgba(96,220,250,0.03)" : "#0b0e15",
              transition: "all 0.2s",
              marginBottom: 20,
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.4 }}>📄</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#94a3b8", marginBottom: 8 }}>
              Drop log file here, or click to browse
            </div>
            <div style={{ fontSize: 13, color: "#4a5568", marginBottom: 20 }}>
              Supports .log, .txt files · Also try <kbd style={{ background: "#1e2433", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>Ctrl+V</kbd> to paste from clipboard
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handlePasteBtn(); }}
              style={{
                background: "#1e2433",
                border: "1px solid #2a3040",
                color: "#94a3b8",
                padding: "8px 20px",
                borderRadius: 8,
                fontSize: 13,
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              📋 Paste from Clipboard
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".log,.txt,.text"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>
        ) : (
          <>
            {/* Controls bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                {[
                  { label: "Total", value: stats.total, color: "#60dcfa" },
                  { label: "Success", value: stats.success, color: "#34d399" },
                  { label: "Fail", value: stats.fail, color: "#f87171" },
                  { label: "Partial", value: stats.partial, color: "#fbbf24" },
                  { label: "Unknown", value: stats.unknown, color: "#94a3b8" },
                ].map((s) => (
                  <div key={s.label} style={{
                    background: "#0f1117",
                    border: "1px solid #1e2433",
                    borderRadius: 8,
                    padding: "6px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: "'Space Grotesk', sans-serif" }}>{s.value}</span>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{s.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Search all columns..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    background: "#0f1117",
                    border: "1px solid #1e2433",
                    borderRadius: 8,
                    padding: "8px 14px",
                    color: "#e2e8f0",
                    fontSize: 13,
                    width: 260,
                    outline: "none",
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                />
                <button
                  onClick={() => { setEntries([]); setFileName(null); setSearchTerm(""); setSortCol(null); }}
                  style={{
                    background: "#1e2433",
                    border: "1px solid #2a3040",
                    color: "#94a3b8",
                    padding: "8px 14px",
                    borderRadius: 8,
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  New File
                </button>
              </div>
            </div>

            {/* Table */}
            <div style={{
              background: "#0b0e15",
              border: "1px solid #1e2433",
              borderRadius: 12,
              overflow: "hidden",
            }}>
              {/* Table Header */}
              <div style={{
                display: "grid",
                gridTemplateColumns: columns.map((c) => c.width).join(" "),
                background: "#0f1219",
                borderBottom: "1px solid #1e2433",
                position: "sticky",
                top: 0,
                zIndex: 10,
              }}>
                {columns.map((col) => (
                  <div
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{
                      padding: "10px 16px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: 0.8,
                      cursor: "pointer",
                      userSelect: "none",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {col.label}
                    <SortIcon active={sortCol === col.key} dir={sortDir} />
                  </div>
                ))}
              </div>

              {/* Table Body */}
              <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
                {filteredEntries.map((entry, idx) => (
                  <div
                    key={entry.id}
                    onClick={() => setSelectedEntry(entry)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: columns.map((c) => c.width).join(" "),
                      borderBottom: "1px solid #141822",
                      cursor: "pointer",
                      transition: "background 0.15s",
                      animation: `fadeIn 0.3s ease ${Math.min(idx * 0.02, 0.5)}s both`,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#111625")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {columns.map((col) => (
                      <div
                        key={col.key}
                        style={{
                          padding: "10px 16px",
                          fontSize: 12,
                          fontFamily: col.key === "utterance" ? "'DM Sans', sans-serif" : "'IBM Plex Mono', monospace",
                          color: col.key === "utterance" ? "#e2e8f0" : "#94a3b8",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontWeight: col.key === "utterance" ? 500 : 400,
                        }}
                      >
                        {col.key === "result" ? (
                          <Badge result={entry[col.key]} />
                        ) : col.key === "utterance" ? (
                          <span style={{ color: "#60dcfa", textDecoration: "underline", textUnderlineOffset: 2 }}>
                            {entry[col.key] || "N/A"}
                          </span>
                        ) : (
                          entry[col.key] || "N/A"
                        )}
                      </div>
                    ))}
                  </div>
                ))}

                {filteredEntries.length === 0 && !parsing && (
                  <div style={{ padding: 40, textAlign: "center", color: "#4a5568", fontSize: 14 }}>
                    No entries found {searchTerm ? `matching "${searchTerm}"` : ""}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Detail modal */}
      {selectedEntry && (
        <DetailView entry={selectedEntry} config={config} onClose={() => setSelectedEntry(null)} />
      )}
    </div>
  );
}
