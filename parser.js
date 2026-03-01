// Extracted parsing logic for testing
// This module contains the core parsing logic from index.html

function createParser(config) {
  const startREs = config.start_patterns.map(p => new RegExp(p));
  const endREs = config.end_patterns.map(p => new RegExp(p));

  function parseText(text) {
    const entries = [];
    const lines = text.split('\n');
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

  // Extract utterance patterns
  for (const [, cfg] of Object.entries(config.utterance_patterns || {})) {
    try {
      const re = new RegExp(cfg.pattern);
      for (const l of lines) {
        const m = l.match(re);
        if (m) {
          e.utterance = cfg.utterance.replace('{value}', m[1].trim());
          break;
        }
      }
      if (e.utterance) break;
    } catch {}
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
