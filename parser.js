// Extracted parsing logic for testing
// This module contains the core parsing logic from index.html

function createParser(config) {
  const startREs = config.start_patterns.map(p => new RegExp(p));
  const endREs = config.end_patterns.map(p => new RegExp(p));

  function parseText(text) {
    const entries = [];
    // ── FIX: Normalize all newline variants ──
    // SDB-pulled logs may contain \r\n (CRLF), \r (CR-only),
    // or literal two-char "\n" sequences inside JSON payloads.
    // Step 1: Normalize real CRLF/CR to LF
    let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Step 2: Replace literal backslash-n followed by timestamp pattern
    //         (common in SDB logcat output where \n is embedded in JSON strings)
    //         e.g., {"result":"ok"}\n[28-02-2026 06.25.44.857] → split into proper lines
    normalized = normalized.replace(/\\n(?=\[?\d{2}-\d{2}-\d{4}\s)/g, '\n');
    // Also handle: literal \n before logcat-style tags (e.g. \n11136.181 E/VOICE_CLIENT)
    normalized = normalized.replace(/\\n(?=\d{4,6}\.\d{1,3}\s+[VDIWEF]\/)/g, '\n');
    const lines = normalized.split('\n');
    const total = lines.length;
    let buffer = [];
    let bufferLines = [];
    let inBlock = false;
    let found = 0;
    let matched = 0;

    // This is the FIXED tick() logic from index.html (lines 545-560)
    for (let idx = 0; idx < total; idx++) {
      const t = lines[idx].trim();
      if (!t) continue;
      
      const isS = startREs.some(r => r.test(t));
      const isE = endREs.some(r => r.test(t));
      
      // FIXED: Allow start handling regardless of inBlock state
      if (isS) {
        // Auto-close current session if already in block with buffered data
        if (inBlock && buffer.length > 0) {
          const entry = parseBlock(buffer, bufferLines, config);
          entries.push(entry);
          found++;
          matched += buffer.length;
          buffer = [];
          bufferLines = [];
          inBlock = false;
        }
        buffer = [t];
        bufferLines = [idx + 1];
        inBlock = true;
      }
      else if (isE && inBlock) {
        buffer.push(t);
        bufferLines.push(idx + 1);
        const entry = parseBlock(buffer, bufferLines, config);
        entries.push(entry);
        found++;
        matched += buffer.length;
        buffer = [];
        bufferLines = [];
        inBlock = false;
      }
      else if (inBlock) {
        buffer.push(t);
        bufferLines.push(idx + 1);
      }
    }
    
    // FIXED: Save buffered data at EOF if present
    if (inBlock && buffer.length > 0) {
      const entry = parseBlock(buffer, bufferLines, config);
      entries.push(entry);
      found++;
      matched += buffer.length;
    }
    
    return {
      entries,
      found,
      matched,
      // Expose internal state for testing
      finalBuffer: buffer,
      finalBufferLines: bufferLines,
      finalInBlock: inBlock
    };
  }

  return { parseText };
}

function parseBlock(lines, lineNumbers, config) {
  const e = {
    id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    conversationId: null,
    requestId: null,
    utterance: null,
    result: 'Unknown',
    successLine: null,
    failLines: [],
    allLines: lines,
    lineNumbers: lineNumbers,
    patternGroups: {}
  };

  // Extract clickable patterns
  for (const [key, cfg] of Object.entries(config.clickable_patterns || {})) {
    try {
      const re = new RegExp(cfg.pattern);
      for (const l of lines) {
        const m = l.match(re);
        if (m) {
          e[key] = m[1];
          break;
        }
      }
    } catch {}
  }

  // Extract utterance patterns - search all lines thoroughly
  if (!e.utterance) {
    for (const l of lines) {
      // Check all patterns against each line
      for (const [, cfg] of Object.entries(config.utterance_patterns || {})) {
        try {
          const re = new RegExp(cfg.pattern);
          const m = l.match(re);
          if (m) {
            e.utterance = cfg.utterance.replace('{value}', m[1].trim());
            break;
          }
        } catch {}
      }
      if (e.utterance) break;
    }
  }
  
  // If still no utterance, extract from start line if it matches pattern
  if (!e.utterance && lines.length > 0) {
    const firstLine = lines[0];
    // Try comma-separated format
    const commaIdx = firstLine.indexOf(',');
    if (commaIdx > -1) {
      const extracted = firstLine.substring(commaIdx + 1).trim();
      if (extracted && extracted.length > 0) {
        e.utterance = extracted;
      }
    }
    // Try bracket format
    if (!e.utterance) {
      const bracketMatch = firstLine.match(/\[([^\]]+)\]/);
      if (bracketMatch) {
        e.utterance = bracketMatch[1];
      }
    }
  }

  // Determine result status
  let hasS = false, hasF = false;
  for (const l of lines) {
    for (const sp of config.success_patterns || []) {
      if (l.includes(sp)) {
        hasS = true;
        e.successLine = l;
      }
    }
    if (config.failure_patterns) {
      for (const fp of config.failure_patterns) {
        if (l.includes(fp)) {
          hasF = true;
          e.failLines.push(l);
        }
      }
    }
  }
  
  if (hasS && !hasF) e.result = 'SUCCESS';
  else if (hasS && hasF) e.result = 'PARTIAL';
  else if (!hasS && hasF) e.result = 'FAIL';
  else e.result = 'Unknown';

  // Extract pattern groups
  for (const [gK, gC] of Object.entries(config.pattern_groups || {})) {
    const ml = [];
    for (const l of lines) {
      for (const p of gC.patterns) {
        try {
          if (new RegExp(p).test(l)) {
            ml.push(l);
            break;
          }
        } catch {}
      }
    }
    if (ml.length > 0) {
      e.patternGroups[gK] = { name: gC.name, lines: ml };
    }
  }
  
  return e;
}

module.exports = { createParser };
