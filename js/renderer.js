/**
 * renderer.js - Main logic for Voice Interaction Log Analyzer
 */

// ── State ──
let CONFIG = getDefaultConfig();
let entries = [];
let filteredData = [];
let sortCol = null;
let sortDir = 'asc';
let sortState = {}; // track sort state: asc -> desc -> none
let currentFileName = null;
let currentFilePath = null;
let currentRawText = null;
let currentFilePath_base = null; // base filename without extension
let currentEncoding = null;
let APP_VERSION = '';
let screenshotViewerScale = 1;
let columnFilters = {}; // per-column search filters
let isAnalyzing = false; // track if analysis is in progress
let detailWindows = []; // track open detail windows
let parseInterrupt = false; // flag to interrupt parsing
let isDetailWindow = false; // track if this window is a detail display
let currentDetailData = null; // holds utterance data if this is a detail window
let streamingMode = false; // streaming analysis mode (false = wait until complete, true = show results in real-time)
let currentConfigFileName = null; // currently active preset config filename

// ── Logging ──
function logToFile(level, message, ...args) {
    // Also log to the dev console
    const consoleLevel = level === 'error' ? 'error' : 'info';
    console[consoleLevel](message, ...args);
    
    if (window.electronAPI && window.electronAPI.logMessage) {
        window.electronAPI.logMessage({ level, message, args });
    }
}
// ── Error Toast System ──
let errorToastId = 0;

function showErrorToast(message, stack) {
    logToFile('error', message, stack); // Log every error shown to the user
    const container = document.getElementById('errorToastContainer');
    if (!container) return;
    const id = ++errorToastId;
    const time = new Date().toLocaleTimeString();
    const hasStack = stack && stack !== message;

    const toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.id = 'errorToast_' + id;
    toast.innerHTML = `
    <div class="error-toast-hdr">
      <div class="error-toast-hdr-left">
        <div class="error-toast-icon">⚠️</div>
        <span class="error-toast-title">Error</span>
      </div>
      <button class="error-toast-close" onclick="dismissErrorToast(${id})">✕</button>
    </div>
    <div class="error-toast-body">
      <div class="error-toast-msg">${escapeHtml(message)}</div>
      ${hasStack ? `<button class="error-toast-toggle" onclick="toggleErrorStack(${id})">Show details</button>
      <div class="error-toast-stack" id="errorStack_${id}">
        <div class="error-toast-msg" style="color:#7f5555;font-size:11px">${escapeHtml(stack)}</div>
      </div>` : ''}
    </div>
    <div class="error-toast-time">${time}</div>
  `;
    container.appendChild(toast);

    // Auto-dismiss after 15 seconds
    setTimeout(() => dismissErrorToast(id), 15000);

    // Keep max 5 toasts
    while (container.children.length > 5) {
        container.removeChild(container.firstChild);
    }
}

function dismissErrorToast(id) {
    const toast = document.getElementById('errorToast_' + id);
    if (toast) {
        toast.style.transition = 'opacity 0.2s, transform 0.2s';
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 200);
    }
}

function toggleErrorStack(id) {
    const stack = document.getElementById('errorStack_' + id);
    if (stack) stack.classList.toggle('show');
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
}

// ── Zoom Controls ──
let zoomLevel = 1;

function applyZoom() {
    document.body.style.zoom = zoomLevel;
}

function changeZoom(delta) {
    zoomLevel = Math.min(Math.max(0.5, zoomLevel + delta), 3);
    applyZoom();
}

// ── Initialization ──
async function init() {
    // 0. Detail Window Loading Overlay (Query 파라미터 확인)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'detail') {
        const lo = document.getElementById('loadingOverlay');
        if (lo) lo.classList.add('active');
    }

    // 1. Detail View 이벤트 리스너 등록 (Race condition 방지를 위해 최상단으로 이동)
    if (window.electronAPI && window.electronAPI.onSetUtteranceData) {
        window.electronAPI.onSetUtteranceData((data) => {
            console.log("Received utterance data for detail window");
            isDetailWindow = true; // Mark as detail window
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay) loadingOverlay.classList.remove('active');
            displayDetailWindow(data);
        });
    }

    const savedStreamingMode = localStorage.getItem('streamingMode');
    if (savedStreamingMode !== null) streamingMode = savedStreamingMode === 'true';
    updateModeButtons();

    if (window.electronAPI) {
        // 2. 버전 정보 로드
        if (window.electronAPI.getAppVersion) {
            APP_VERSION = await window.electronAPI.getAppVersion();
            document.getElementById('appSub').textContent = `[${APP_VERSION}] by SimpsonYS`;
        }

        // 3. 프리셋 목록 로드
        try {
            console.log("Refreshing preset list...");
            await refreshPresetList();
        } catch (err) {
            console.error("Error refreshing presets:", err);
            document.getElementById('presetRadios').innerHTML = '<span style="color:red;font-size:11px">Error loading presets</span>';
        }

        // 4. Config 로드
        try {
            const result = await window.electronAPI.loadConfig();
            if (result) {
                CONFIG = result.config;
                currentConfigFileName = result.fileName;

                // Config가 로드된 후, 해당 파일에 맞는 라디오 버튼을 체크합니다.
                console.log("Config loaded:", currentConfigFileName);
                updatePresetRadioSelection(currentConfigFileName);
            }
        } catch (err) {
            console.error("Error loading config:", err);
        }
    } else {
        // 웹 브라우저 단독 실행 시 (Electron 아님)
        console.warn("Electron API not found. Presets disabled.");
        document.getElementById('presetRadios').innerHTML = '<span style="font-size:11px;color:#64748b">Not in Electron mode</span>';
    }

    // Fallback: ensure CONFIG is never null
    if (!CONFIG) {
        CONFIG = getDefaultConfig();
        console.log("Using default config (fallback)");
    }

    initColumnFilters();
    setupEventListeners();
}

// Initialize column filters
function initColumnFilters() {
    columnFilters = {};
    if (CONFIG && CONFIG.table_columns) {
        CONFIG.table_columns.forEach(col => {
            columnFilters[col.key] = '';
        });
    }
}

// ── Preset Management ──
async function refreshPresetList() {
    if (!window.electronAPI || !window.electronAPI.listPresets) return;

    const presets = await window.electronAPI.listPresets();
    console.log("Presets found:", presets);

    // Sort presets so that pattern_config.json (Default) comes first
    const sortedPresets = [...presets].sort((a, b) => {
        if (a === 'pattern_config.json') return -1;
        if (b === 'pattern_config.json') return 1;
        return a.localeCompare(b);
    });

    const container = document.getElementById('presetRadios');
    container.innerHTML = '';

    if (!sortedPresets || sortedPresets.length === 0) {
        container.innerHTML = '<span style="font-size:11px;color:#64748b">No presets found. Check config folder.</span>';
        return;
    }

    sortedPresets.forEach(fileName => {
        let displayName = fileName;
        if (fileName === 'pattern_config.json') {
            displayName = 'Default';
        } else {
            // 파일명 파싱: Preset0_Name_pattern_config.json -> Name
            const match = fileName.match(/Preset\d+_(.+)_pattern_config\.json/);
            displayName = match ? match[1] : fileName;
            // 언더바를 공백으로 변경하여 가독성 높임
            displayName = displayName.replace(/_/g, ' ');
        }

        const label = document.createElement('label');
        label.className = 'radio-item';
        label.innerHTML = `
      <input type="radio" name="presetConfig" value="${fileName}" onchange="switchPreset('${fileName}')">
      ${displayName}
    `;
        container.appendChild(label);
    });
}

// Switch to a different preset config
async function switchPreset(fileName) {
    if (!window.electronAPI || !window.electronAPI.switchPreset) {
        showErrorToast('switchPreset API not available');
        return;
    }
    try {
        const result = await window.electronAPI.switchPreset(fileName);
        if (result && result.config) {
            CONFIG = result.config;
            currentConfigFileName = result.fileName || fileName;
            updatePresetRadioSelection(currentConfigFileName);
            console.log('Switched to preset:', currentConfigFileName);

            // Re-analyze current file if loaded
            if (currentRawText && currentFileName) {
                entries = [];
                filteredData = [];
                initColumnFilters();
                document.getElementById('tableFilters').innerHTML = '';
                startParsing(currentRawText, currentFileName, currentEncoding || 'utf-8');
            }
        }
    } catch (err) {
        console.error('Failed to switch preset:', err);
        showErrorToast('Failed to switch preset: ' + err.message);
    }
}

// Update radio button selection to match current config
function updatePresetRadioSelection(fileName) {
    if (!fileName) return;
    const radios = document.querySelectorAll('input[name="presetConfig"]');
    radios.forEach(radio => {
        radio.checked = (radio.value === fileName);
    });
}

// Add custom preset via file dialog
async function addCustomPreset() {
    if (!window.electronAPI || !window.electronAPI.addCustomPreset) {
        showErrorToast('Custom preset feature requires the Electron desktop version.');
        return;
    }
    try {
        const result = await window.electronAPI.addCustomPreset();
        if (result && result.success) {
            console.log('Custom preset added:', result.fileName);
            await refreshPresetList();
            // Auto-switch to the newly added preset
            if (result.fileName) {
                await switchPreset(result.fileName);
            }
        }
    } catch (err) {
        console.error('Failed to add custom preset:', err);
        showErrorToast('Failed to add custom preset: ' + err.message);
    }
}

function getDefaultConfig() {
    return {
        start_patterns: ["cmd_from_mockapp", "REQUEST OPEN SERVER"],
        end_patterns: ["Process Finished!"],
        success_patterns: ["result_code=success"],
        failure_patterns: ["result_code=fail"],
        clickable_patterns: {
            conversationId: { pattern: "conversationId\\\\[([^\\\\]]+)\\\\]", url_template: "https://sumologic.bixbydev.com/stg/conversation/?conversationId={value}", display_name: "ConversationID" },
            requestId: { pattern: "requestId\\\\[([^\\\\]]+)\\\\]", url_template: null, display_name: "RequestID" }
        },
        utterance_patterns: {
            cmd_from_mockapp: { pattern: "cmd_from_mockapp, ([^\\\\]]+)", utterance: "{value}" },
            kAsr2Response: { pattern: "kAsr2Response \\\\[FINAL\\\\] \\\\[([^\\\\]]+)\\\\]", utterance: "{value}" }
        },
        pattern_groups: {
            MakeMetaDataParams: { name: "MakeMetaDataParams", patterns: ["MakeMetaDataParams.*"] },
            Actions: { name: "Action", patterns: ["result_code"] }
        },
        table_columns: [
            { key: "conversationId", label: "Conversation ID", width: "22%", clickable_key: "conversationId" },
            { key: "requestId", label: "Request ID", width: "12%" },
            { key: "utterance", label: "Utterance", width: "30%", type: "utterance" },
            { key: "result", label: "Result", width: "8%", type: "badge" },
            { key: "successLine", label: "Success Match", width: "28%", type: "log" }
        ]
    };
}

// ── Event Handlers ──
function setupEventListeners() {
    const dz = document.getElementById('dropzone');
    dz.addEventListener('click', () => openFile());
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => {
        e.preventDefault(); dz.classList.remove('over');
        const file = e.dataTransfer.files?.[0];
        if (file) readFile(file);
    });

    // Secondary drop zone events
    const setupSecondaryDropZone = () => {
        const sdz = document.getElementById('secondaryDropZone');
        if (sdz) {
            sdz.addEventListener('click', () => openFile());
            sdz.addEventListener('dragover', e => { e.preventDefault(); sdz.classList.add('over'); });
            sdz.addEventListener('dragleave', () => sdz.classList.remove('over'));
            sdz.addEventListener('drop', e => {
                e.preventDefault(); sdz.classList.remove('over');
                const file = e.dataTransfer.files?.[0];
                if (file) readFile(file);
            });
        }
    };
    setupSecondaryDropZone();

    document.getElementById('openLogBtn').addEventListener('click', () => {
        if (window.electronAPI && window.electronAPI.openLogFile) {
            window.electronAPI.openLogFile();
        }
    });

    document.addEventListener('paste', e => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        const text = e.clipboardData?.getData('text');
        if (text && text.length > 10) { e.preventDefault(); processText(text, 'clipboard-paste'); }
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeModal();
        // zoom shortcuts
        if (e.ctrlKey) {
            if (e.key === '+' || e.key === '=') { changeZoom(0.1); e.preventDefault(); }
            else if (e.key === '-') { changeZoom(-0.1); e.preventDefault(); }
        }
    });

    // wheel zoom
    document.addEventListener('wheel', e => {
        if (e.ctrlKey) {
            e.preventDefault();
            changeZoom(e.deltaY < 0 ? 0.1 : -0.1);
        }
    }, { passive: false });

    // Global error handlers
    window.addEventListener('error', (e) => {
        console.error('Global error', e.error || e.message);
        const msg = e.error ? e.error.message || e.error.toString() : e.message;
        const stack = e.error && e.error.stack ? e.error.stack : null;
        showErrorToast(msg, stack);
    });
    window.addEventListener('unhandledrejection', (e) => {
        console.error('Unhandled rejection', e.reason);
        const msg = e.reason ? (e.reason.message || String(e.reason)) : 'Unknown rejection';
        const stack = e.reason && e.reason.stack ? e.reason.stack : null;
        showErrorToast(msg, stack);
    });

    // Setup update listeners
    if (window.electronAPI) {
        if (window.electronAPI.onUpdateAvailable) {
            window.electronAPI.onUpdateAvailable((info) => {
                showUpdateModal('New version available! Version: ' + info.version, 'downloading');
                if (window.electronAPI.downloadUpdate) {
                    window.electronAPI.downloadUpdate();
                }
            });
        }

        if (window.electronAPI.onUpdateNotAvailable) {
            window.electronAPI.onUpdateNotAvailable(() => {
                console.log('You are running the latest version.');
            });
        }

        if (window.electronAPI.onDownloadProgress) {
            window.electronAPI.onDownloadProgress((progress) => {
                const percent = Math.round((progress.transferred / progress.total) * 100);
                const content = document.getElementById('updateContent');
                if (content) {
                    content.innerHTML = `<div style="text-align:center;padding:20px">
            <div style="font-size:14px;color:#94a3b8;margin-bottom:12px">Downloading update...</div>
            <div style="background:#1e2433;border-radius:8px;height:6px;overflow:hidden;margin-bottom:8px">
              <div style="height:100%;background:#60dcfa;width:${percent}%;transition:width 0.1s"></div>
            </div>
            <div style="font-size:12px;color:#64748b">${percent}% (${(progress.transferred / 1024 / 1024).toFixed(1)} MB)</div>
          </div>`;
                }
            });
        }

        if (window.electronAPI.onUpdateDownloaded) {
            window.electronAPI.onUpdateDownloaded((info) => {
                showUpdateModal('Update downloaded! Ready to install.', 'ready');
                document.getElementById('updateActionBtn').style.display = 'block';
            });
        }

        if (window.electronAPI.onUpdateError) {
            window.electronAPI.onUpdateError((error) => {
                console.error('Update check failed:', error);
            });
        }
    }
}

function showLoadingState(fileName) {
    document.getElementById('dropzone').style.display = 'none';
    document.getElementById('resultsArea').style.display = '';
    const pp = document.getElementById('progressPanel');
    pp.classList.add('show');
    document.getElementById('progressLayout').style.display = 'block';
    document.getElementById('progressSplitLayout').style.display = 'none';

    document.getElementById('progressLabel').textContent = `Loading ${fileName}...`;
    document.getElementById('progressLabel').style.color = '#94a3b8';
    document.getElementById('progressDot').style.display = 'none';
    document.getElementById('progressBar').style.width = '5%'; 
    document.getElementById('progressCount').textContent = '';
    document.getElementById('progFound').textContent = '0';
    document.getElementById('progMatched').textContent = '0';
    document.getElementById('tableBody').innerHTML = '';
    document.getElementById('statsBar').innerHTML = '';
}

function updateLoadingState(message) {
    const label = document.getElementById('progressLabel');
    if (label) {
        label.textContent = message;
    }
}
// ── File Reading ──
async function openFile() {
    if (window.electronAPI) {
        const filePath = await window.electronAPI.openFileDialog();
        if (filePath) {
            if (isAnalyzing) {
                const shouldContinue = confirm('Analysis in progress. Cancel and open new file?');
                if (!shouldContinue) return;
                parseInterrupt = true;
            }
            const name = filePath.split(/[\\\/]/).pop();
            showLoadingState(name); // Show loading state immediately

            try {
                // Yield to UI thread before reading buffer
                await new Promise(resolve => setTimeout(resolve, 50));
                
                const buffer = await window.electronAPI.readFileBuffer(filePath);
                const baseName = name.replace(/\.[^.]*$/, '');
                currentFilePath = filePath;
                currentFilePath_base = baseName;
                processBuffer(new Uint8Array(buffer).buffer, name);
            } catch (err) {
                showErrorToast(`Failed to read file: ${err.message}`, err.stack);
                // Do not reset, allow user to see the error
            }
        }
    } else {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.log,.txt,.text';
        input.onchange = () => { if (input.files[0]) readFile(input.files[0]); };
        input.click();
    }
}

function readFile(file) {
    showLoadingState(file.name); // Show loading state immediately
    
    if (file.path) {
        currentFilePath = file.path;
        currentFilePath_base = file.name.replace(/\.[^.]*$/, '');
    }
    
    const reader = new FileReader();
    reader.onload = e => processBuffer(e.target.result, file.name);
    reader.onerror = err => {
        showErrorToast(`File reading error: ${err.message}`, err.stack);
        // Do not reset
    };
    reader.readAsArrayBuffer(file);
}

async function doPaste() {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            showLoadingState('clipboard-paste');
            await new Promise(resolve => setTimeout(resolve, 50)); // Yield to UI
            processText(text, 'clipboard-paste');
        }
    } catch { 
        showErrorToast('Clipboard access denied. Use Ctrl+V instead.');
    }
}

function detectEncoding(buffer) {
    const b = new Uint8Array(buffer);
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return 'utf-8';
    if (b[0] === 0xFF && b[1] === 0xFE) return 'utf-16le';
    if (b[0] === 0xFE && b[1] === 0xFF) return 'utf-16be';
    let ok = true;
    for (let i = 0; i < Math.min(b.length, 8000); i++) {
        if (b[i] > 0x7F) {
            if ((b[i] & 0xE0) === 0xC0) { if (i + 1 >= b.length || (b[i + 1] & 0xC0) !== 0x80) { ok = false; break; } i++; }
            else if ((b[i] & 0xF0) === 0xE0) { if (i + 2 >= b.length || (b[i + 1] & 0xC0) !== 0x80 || (b[i + 2] & 0xC0) !== 0x80) { ok = false; break; } i += 2; }
            else if ((b[i] & 0xF8) === 0xF0) { if (i + 3 >= b.length) { ok = false; break; } i += 3; }
            else { ok = false; break; }
        }
    }
    return ok ? 'utf-8' : 'euc-kr';
}

function stripTs(line) {
    const m = line.match(/[A-Z]\/[\w]+\s*\(\s*\d+\)\s*:/);
    return m ? line.substring(m.index) : line;
}

function processBuffer(buffer, name) {
    try {
        updateLoadingState("Detecting encoding...");
        const enc = detectEncoding(buffer);
        updateLoadingState(`Decoding file (${enc.toUpperCase()})...`);
        
        setTimeout(() => {
            try {
                const text = new TextDecoder(enc).decode(buffer);
                currentEncoding = enc;
                currentFileName = name;
                currentRawText = text;
                startParsing(text, name, enc);
            } catch (e) {
                showErrorToast(`Failed to decode file. Try a different encoding if possible. Error: ${e.message}`, e.stack);
                // Do not reset
            }
        }, 50);

    } catch (e) {
        showErrorToast(`Failed to process file buffer: ${e.message}`, e.stack);
        // Do not reset
    }
}

function processText(text, name) {
    try {
        currentEncoding = 'utf-8';
        currentFileName = name;
        currentRawText = text;
        logToFile('info', 'Processing text from clipboard');
        startParsing(text, name, 'utf-8');
    } catch (e) {
        showErrorToast(`Failed to process text: ${e.message}`, e.stack);
        // Do not reset
    }
}

async function refreshAnalysis() {
    if (!currentRawText || !currentFileName) { alert('분석된 파일이 없습니다.'); return; }
    if (isAnalyzing) { alert('현재 분석 중입니다.'); return; }
    if (window.electronAPI && window.electronAPI.loadConfig) {
        const nc = await window.electronAPI.loadConfig();
        if (nc && nc.config) { CONFIG = nc.config; currentConfigFileName = nc.fileName; }
        else if (nc) CONFIG = nc;
    }
    initColumnFilters();
    document.getElementById('tableFilters').innerHTML = '';
    startParsing(currentRawText, currentFileName, currentEncoding || 'utf-8');
}

// ── Parsing Logic ──
function startParsing(text, name, enc) {
    entries = [];
    parseInterrupt = false;
    isAnalyzing = true;
    sortCol = null; sortDir = 'asc';
    sortState = {};
    const searchBox = document.getElementById('searchBox');
    if (searchBox) searchBox.value = '';
    initColumnFilters();
    showProgress(name, enc);

    const SDB_NEWLINE_MARKER = /\\nL\\d{1,5}/g;
    if (text.includes("nL")) {
        text = text.replace(SDB_NEWLINE_MARKER, "\\n");
    }

    const lines = text.split(/\r?\n|\r/), total = lines.length;
    const startCombined = new RegExp(CONFIG.start_patterns.join('|'));
    const endCombined = new RegExp(CONFIG.end_patterns.join('|'));
    let buffer = [], bufferLines = [], inBlock = false, idx = 0, found = 0, matched = 0;
    const CHUNK = 3000; // Chunk size for UI responsiveness

    function tick() {
        if (parseInterrupt) { finishParsing(); return; }
        const end = Math.min(idx + CHUNK, total);
        for (; idx < end; idx++) {
            const t = lines[idx].trim(); if (!t) continue;
            const isS = startCombined.test(t);
            const isE = endCombined.test(t);
            if (isS) {
                if (inBlock && buffer.length > 0) {
                    const entry = parseBlock(buffer, bufferLines);
                    entries.push(entry);
                    found++; matched += buffer.length;
                    buffer = []; bufferLines = []; inBlock = false;
                }
                buffer = [t]; bufferLines = [idx + 1]; inBlock = true;
            }
            else if (isE && inBlock) {
                buffer.push(t);
                bufferLines.push(idx + 1);
                const entry = parseBlock(buffer, bufferLines);
                entries.push(entry);
                found++; matched += buffer.length;
                buffer = []; bufferLines = []; inBlock = false;
            }
            else if (inBlock) { buffer.push(t); bufferLines.push(idx + 1); }
        }
        updateProgress(idx, total, found, matched);
        if (idx < total) { requestAnimationFrame(tick); }
        else {
            if (inBlock && buffer.length > 0) {
                const entry = parseBlock(buffer, bufferLines);
                entries.push(entry);
                found++; matched += buffer.length;
            }
            finishParsing();
        }
    }
    requestAnimationFrame(tick);
}

function parseBlock(lines, lineNumbers = []) {
    const e = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        conversationId: null, requestId: null, utterance: null,
        result: 'Unknown', successLine: null, failLines: [], allLines: lines, lineNumbers: lineNumbers, patternGroups: {}
    };

    for (const [key, cfg] of Object.entries(CONFIG.clickable_patterns)) {
        try {
            const re = new RegExp(cfg.pattern);
            for (const l of lines) { const m = l.match(re); if (m) { e[key] = m[1]; break; } }
        } catch { }
    }

    if (!e.utterance) {
        for (const l of lines) {
            for (const [, cfg] of Object.entries(CONFIG.utterance_patterns)) {
                try {
                    const re = new RegExp(cfg.pattern);
                    const m = l.match(re);
                    if (m) {
                        e.utterance = cfg.utterance.replace('{value}', m[1].trim());
                        break;
                    }
                } catch { }
            }
            if (e.utterance) break;
        }
    }

    let hasS = false, hasF = false;
    for (const l of lines) {
        for (const sp of CONFIG.success_patterns) if (l.includes(sp)) { hasS = true; e.successLine = l; }
        if (CONFIG.failure_patterns) for (const fp of CONFIG.failure_patterns) if (l.includes(fp)) { hasF = true; e.failLines.push(l); }
    }
    if (hasS && !hasF) e.result = 'SUCCESS';
    else if (hasS && hasF) e.result = 'PARTIAL';
    else if (!hasS && hasF) e.result = 'FAIL';
    else e.result = 'Unknown';

    for (const [gK, gC] of Object.entries(CONFIG.pattern_groups || {})) {
        const ml = [];
        for (const l of lines) {
            for (const p of gC.patterns) {
                try {
                    if (new RegExp(p).test(l)) {
                        ml.push(l);
                        break;
                    }
                } catch { }
            }
        }
        if (ml.length > 0) {
            e.patternGroups[gK] = { name: gC.name, lines: ml };
        }
    }

    return e;
}

// ── UI Rendering ──
function showProgress(name, enc) {
    document.getElementById('dropzone').style.display = 'none';
    document.getElementById('resultsArea').style.display = '';
    document.getElementById('exportBtn').style.display = '';
    document.getElementById('refreshBtn').style.display = '';

    const pp = document.getElementById('progressPanel');
    pp.classList.add('show');
    document.getElementById('progressLayout').style.display = 'block';
    document.getElementById('progressSplitLayout').style.display = 'none';

    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('progressCount').textContent = '';
    document.getElementById('progFound').textContent = '0';
    document.getElementById('progMatched').textContent = '0';

    document.getElementById('tableBody').innerHTML = '';
    document.getElementById('statsBar').innerHTML = '';

    document.getElementById('progressFile').textContent = `(${name})`;
    document.getElementById('progressEnc').textContent = enc.toUpperCase();
    document.getElementById('progressEnc').style.display = '';
    document.getElementById('progressLabel').textContent = 'Analyzing...';
    document.getElementById('progressLabel').style.color = '#60dcfa';
    document.getElementById('progressDot').style.display = '';

    const modeEl = document.getElementById('progressMode');
    if (streamingMode) {
        modeEl.textContent = '⚡ STREAM';
        modeEl.style.background = '#1a3a5c';
        modeEl.style.color = '#60dcfa';
        modeEl.style.border = '1px solid #2a4a7c';
        document.getElementById('batchWaitMsg').style.display = 'none';
    } else {
        modeEl.textContent = '📋 BATCH';
        modeEl.style.background = '#1e2433';
        modeEl.style.color = '#94a3b8';
        modeEl.style.border = '1px solid #2a3040';
        document.getElementById('batchWaitMsg').style.display = '';
    }
}

function updateProgress(processed, total, found, matched) {
    const pct = (processed / total * 100).toFixed(1);
    document.getElementById('progressBar').style.width = pct + '%';
    document.getElementById('progressCount').textContent = `${processed.toLocaleString()} / ${total.toLocaleString()} lines`;
    document.getElementById('progFound').textContent = found;
    document.getElementById('progMatched').textContent = matched;
    if (streamingMode) {
        renderTable();
    }
}

function finishParsing() {
    isAnalyzing = false;
    parseInterrupt = false;

    document.getElementById('batchWaitMsg').style.display = 'none';

    document.getElementById('progressFile2').textContent = document.getElementById('progressFile').textContent;
    document.getElementById('progressEnc2').textContent = document.getElementById('progressEnc').textContent;
    document.getElementById('progressEnc2').style.display = document.getElementById('progressEnc').style.display;
    document.getElementById('progressCount2').textContent = document.getElementById('progressCount').textContent;
    document.getElementById('progFound2').textContent = document.getElementById('progFound').textContent;
    document.getElementById('progMatched2').textContent = document.getElementById('progMatched').textContent;

    document.getElementById('progressLayout').style.display = 'none';
    document.getElementById('progressSplitLayout').style.display = '';

    renderTable();
}

function renderStats() {
    const s = { total: entries.length, success: 0, fail: 0, partial: 0, unknown: 0 };
    for (const e of entries) {
        if (e.result === 'SUCCESS') s.success++;
        else if (e.result === 'FAIL') s.fail++;
        else if (e.result === 'PARTIAL') s.partial++;
        else s.unknown++;
    }
    s.passRate = (s.success + s.fail) > 0 ? ((s.success / (s.success + s.fail)) * 100).toFixed(1) : '-';

    document.getElementById('statsBar').innerHTML = [
        { l: 'Total', v: s.total, c: '#60dcfa' }, { l: 'Success', v: s.success, c: '#34d399' },
        { l: 'Fail', v: s.fail, c: '#f87171' }, { l: 'Partial', v: s.partial, c: '#fbbf24' },
        { l: 'Unknown', v: s.unknown, c: '#94a3b8' }, { l: 'Pass Rate', v: s.passRate === '-' ? '-' : s.passRate + '%', c: '#a78bfa' }
    ].map(s => `<div class="stat"><span class="stat-val" style="color:${s.c}">${s.v}</span><span class="stat-label">${s.l}</span></div>`).join('');
    return s;
}

function esc(s) { return s ? s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>') : 'N/A'; }

function makeClickable(text) {
    if (!CONFIG || !text) return esc(text);
    let r = esc(text);
    for (const [, c] of Object.entries(CONFIG.clickable_patterns)) {
        try {
            const re = new RegExp(c.pattern, 'g');
            r = r.replace(re, (m, v) => {
                if (c.url_template) return `<a href="${c.url_template.replace('{value}', v)}" target="_blank" class="click-link" onclick="event.stopPropagation()">${m}</a>`;
                return `<span style="color:#a8e6cf;font-weight:600">${m}</span>`;
            });
        } catch { }
    }
    return r;
}

function extractLogDisplay(line, colKey) {
    if (!line) return null;
    const arrowIdx = line.lastIndexOf('> ');
    const payload = arrowIdx >= 0 ? line.substring(arrowIdx + 2).trim() : line.trim();
    if (CONFIG.pattern_groups && CONFIG.pattern_groups[colKey]) {
        for (const p of CONFIG.pattern_groups[colKey].patterns) {
            try {
                if (new RegExp(p).test(payload)) {
                    const litMatch = p.match(/^([A-Za-z0-9_ ]+)/);
                    const prefix = litMatch ? litMatch[1].trim() : '';
                    if (prefix && payload.toLowerCase().startsWith(prefix.toLowerCase())) {
                        return payload.substring(prefix.length).trim() || payload;
                    }
                    return payload;
                }
            } catch { }
        }
    }
    return payload;
}

function renderTable() {
    renderStats();
    const cols = CONFIG.table_columns;
    const gridCols = cols.map(c => c.width).join(' ');

    document.getElementById('tableHead').style.gridTemplateColumns = gridCols;
    document.getElementById('tableHead').innerHTML = cols.map(c => {
        let icon = '<span style="opacity:0.25">⇅</span>';
        if (sortState[c.key] === 'asc') icon = '↑';
        else if (sortState[c.key] === 'desc') icon = '↓';
        return `<div class="th" onclick="cycleSort('${c.key}')" title="Sort by ${c.label}">${c.label}<span class="sort-icon">${icon}</span></div>`;
    }).join('');

    const filtersEl = document.getElementById('tableFilters');
    if (filtersEl.querySelectorAll('.filter-input').length !== cols.length) {
        filtersEl.style.gridTemplateColumns = gridCols;
        filtersEl.innerHTML = cols.map(c =>
            `<div class="filter-cell"><input class="filter-input" placeholder="${c.label}..." data-col="${c.key}" value="${columnFilters[c.key] || ''}" oninput="renderTableBody()"></div>`
        ).join('');
    }

    filtersEl.querySelectorAll('.filter-input').forEach(inp => {
        columnFilters[inp.dataset.col] = inp.value.toLowerCase();
    });

    const q = (document.getElementById('searchBox').value || '').toLowerCase();
    let rows = entries.filter(e => {
        if (q) {
            const hasGlobal = (e.conversationId || '').toLowerCase().includes(q) ||
                (e.requestId || '').toLowerCase().includes(q) ||
                (e.utterance || '').toLowerCase().includes(q) ||
                e.result.toLowerCase().includes(q) ||
                (e.successLine || '').toLowerCase().includes(q);
            if (!hasGlobal) return false;
        }
        for (const [col, filter] of Object.entries(columnFilters)) {
            if (!filter) continue;
            const val = (e[col] || '').toString().toLowerCase();
            if (!val.includes(filter)) return false;
        }
        return true;
    });

    const sortKey = Object.keys(sortState).find(k => sortState[k]);
    if (sortKey) {
        rows = [...rows].sort((a, b) => {
            const va = (a[sortKey] || '').toString().toLowerCase();
            const vb = (b[sortKey] || '').toString().toLowerCase();
            return sortState[sortKey] === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        });
    }

    filteredData = rows;

    if (rows.length === 0) {
        document.getElementById('tableBody').innerHTML = `<div class="empty-msg">No entries found${q ? ` matching "${esc(q)}"` : ''}</div>`;
        return;
    }

    document.getElementById('tableBody').innerHTML = rows.map((e, i) => {
        const cells = cols.map(c => {
            const v = e[c.key];
            if (c.type === 'badge') return `<div class="td"><span class="badge badge-${v}">${v}</span></div>`;
            if (c.type === 'utterance') return `<div class="td"><span class="utt-link" title="Click to detail">${esc(v)}</span></div>`;
            if (c.type === 'log' && v) {
                const display = extractLogDisplay(v, c.key);
                const lineIdx = e.allLines ? e.allLines.indexOf(v) : -1;
                const lineNum = (lineIdx >= 0 && e.lineNumbers) ? e.lineNumbers[lineIdx] : '';
                return `<div class="td" title="${esc(v)}">${esc(display)}${lineNum ? ` <span style="color:#334155;font-size:10px">[L${lineNum}]</span>` : ''}</div>`;
            }
            if (c.clickable_key) {
                const cp = CONFIG.clickable_patterns[c.clickable_key];
                if (cp && cp.url_template && v) {
                    return `<div class="td"><a class="click-link" href="javascript:openURLExternal('${cp.url_template.replace('{value}', v)}')" onclick="event.stopPropagation()">${esc(v)}</a></div>`;
                }
            }
            return `<div class="td">${esc(v)}</div>`;
        }).join('');
        return `<div class="tr" style="grid-template-columns:${gridCols};animation-delay:${Math.min(i * 0.015, 0.4)}s" onclick="openDetailFromTable(${i})">${cells}</div>`;
    }).join('');
}

function renderTableBody() { renderTable(); }

function cycleSort(col) {
    if (sortState[col] === 'asc') sortState[col] = 'desc';
    else if (sortState[col] === 'desc') delete sortState[col];
    else sortState = { [col]: 'asc' };
    renderTable();
}

// ── Streaming Mode ──
function setStreamingMode(enabled) {
    streamingMode = enabled;
    localStorage.setItem('streamingMode', streamingMode);
    updateModeButtons();
}

function updateModeButtons() {
    const batchBtn = document.getElementById('modeBtnBatch');
    const streamBtn = document.getElementById('modeBtnStream');
    if (!batchBtn || !streamBtn) return;
    if (streamingMode) {
        streamBtn.classList.add('active');
        batchBtn.classList.remove('active');
    } else {
        batchBtn.classList.add('active');
        streamBtn.classList.remove('active');
    }
}

// ── Detail & Modals ──
function openURLExternal(url) {
    if (window.electronAPI && window.electronAPI.openExternal) {
        window.electronAPI.openExternal(url);
    } else {
        window.open(url, '_blank');
    }
}

function copyToClipboard(text) {
    const decoded = text.replace(/\\n/g, '\n');
    const onDone = () => showToast('Copied to clipboard.');
    if (navigator.clipboard) {
        navigator.clipboard.writeText(decoded).then(onDone).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = decoded; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); onDone();
        });
    } else {
        const ta = document.createElement('textarea');
        ta.value = decoded; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); onDone();
    }
}

function showToast(message) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;display:flex;flex-direction:column;gap:10px;pointer-events:none';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.cssText = 'background:rgba(0,0,0,0.85);color:white;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.5);animation:fadeInOut 1s ease-in-out forwards;border:1px solid #333';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
        if (container.children.length === 0) container.remove();
    }, 1000);
}

async function openDetailFromTable(idx) {
    const e = filteredData[idx];
    if (!e) return;
    if (isDetailWindow || !window.electronAPI || !window.electronAPI.openDetailWindow) {
        showDetail(idx); return;
    }
    try {
        await window.electronAPI.openDetailWindow({ 
            utteranceData: e, 
            utteranceIndex: idx + 1,
            logFilePath: currentFilePath,
            config: CONFIG
        });
    } catch (err) {
        console.error("Failed to open detail window:", err);
        showDetail(idx);
    }
}

async function displayDetailWindow(data) {
    const { utteranceData: e, utteranceIndex, logFilePath: path, config } = data;
    if (path) currentFilePath = path;
    if (config) CONFIG = config;
    if (!e) return;

    const main = document.querySelector('.main');
    if (main) main.style.display = 'none';

    const header = document.querySelector('.header');
    if (header) {
        const exportBtn = header.querySelector('#exportBtn');
        if (exportBtn) exportBtn.style.display = 'none';
        const refreshBtn = header.querySelector('#refreshBtn');
        if (refreshBtn) refreshBtn.style.display = 'none';
        const presetBar = header.querySelector('#presetBar');
        if (presetBar) presetBar.style.display = 'none';
        const updateBtn = header.querySelector('#updateBtn');
        if (updateBtn) updateBtn.style.display = 'none';
        const streamingLabel = header.querySelector('#streamingLabel');
        if (streamingLabel) streamingLabel.style.display = 'none';
    }

    let h = `<div class="modal-body" style="max-width:none;height:100vh;display:flex;flex-direction:column;border-radius:0">`;
    h += `<div class="modal-hdr" style="border-bottom:1px solid #1e2433"><div style="flex:1"><div style="font-size:18px;font-weight:700">Utterance Detail #${utteranceIndex}</div><div style="font-size:13px;color:#64748b;margin-top:2px">${esc(e.utterance)}</div></div></div>`;
    h += '<div class="modal-content" style="flex:1;overflow-y:auto"><div class="meta-grid">';

    [{ l: 'Conversation ID', v: e.conversationId, ck: 'conversationId' }, { l: 'Request ID', v: e.requestId, ck: 'requestId' }, { l: 'Utterance', v: e.utterance }, { l: 'Result', v: e.result, b: 1 }].forEach(m => {
        h += `<div class="meta-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div class="meta-label">${m.l}</div>`;
        if (m.l === 'Conversation ID' && m.v) {
            h += `<button class="btn btn-ghost" style="padding:2px 6px;font-size:10px" onclick="copyToClipboard('${m.v.replace(/'/g, "\\'")}')" title="Copy ID">📋 Copy</button>`;
        }
        h += '</div>';
        if (m.b) h += `<span class="badge badge-${m.v}">${m.v}</span>`;
        else if (m.ck && CONFIG && CONFIG.clickable_patterns && CONFIG.clickable_patterns[m.ck] && CONFIG.clickable_patterns[m.ck].url_template && m.v)
            h += `<a href="${CONFIG.clickable_patterns[m.ck].url_template.replace('{value}', m.v)}" target="_blank" class="click-link" style="font-size:13px;font-family:Consolas,monospace;word-break:break-all" onclick="window.electronAPI.openExternal('${CONFIG.clickable_patterns[m.ck].url_template.replace('{value}', m.v)}');return false">${esc(m.v)}</a>`;
        else h += `<div class="meta-val">${esc(m.v)}</div>`;
        h += '</div>';
    });
    h += '</div>';

    if (e.successLine) h += `<div class="section"><div class="sec-title" style="color:#34d399">✓ Success Match</div><div class="succ-box">${makeClickable(stripTs(e.successLine))}</div></div>`;
    if (e.failLines.length > 0) h += `<div class="section"><div class="sec-title" style="color:#f87171">✗ Failure Matches</div><div class="fail-box">${e.failLines.map(l => makeClickable(stripTs(l))).join('<br>')}</div></div>`;

    if (Object.keys(e.patternGroups).length > 0) {
        h += '<div class="section"><div class="sec-title" style="color:#60dcfa">Pattern Groups</div>';
        for (const [, g] of Object.entries(e.patternGroups)) {
            const groupText = g.lines.join('\n');
            h += `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center"><div class="grp-name">${esc(g.name)}</div><button class="btn btn-ghost" style="padding:4px 8px;font-size:10px" onclick="copyToClipboard('${groupText.replace(/'/g, "\\'").replace(/\n/g, '\\n')}')" title="Copy">📋 Copy</button></div><div class="log-box" style="max-height:200px">${g.lines.map(l => makeClickable(stripTs(l))).join('<br>')}</div></div>`;
        }
        h += '</div>';
    }

    if (window.electronAPI && currentFilePath) {
        const screenshots = await window.electronAPI.getScreenshots({ 
            logFilePath: currentFilePath, 
            utterance: e.utterance 
        });
        if (screenshots && screenshots.length > 0) {
            h += '<div class="section"><div class="sec-title" style="color:#a78bfa">📸 Screenshots</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-top:8px">';
            screenshots.forEach((ss, idx) => {
                const ssId = `ss_${idx}_${Date.now()}`;
                h += `<div style="cursor:pointer;border:1px solid #1e2433;border-radius:6px;overflow:hidden;aspect-ratio:1;background:#0a0d14;display:flex;align-items:center;justify-content:center;transition:all 0.2s" onclick="showScreenshotViewer('${ss.path.replace(/'/g, "\\'")}')" title="${esc(ss.name)}" onmouseover="this.style.borderColor='#a78bfa'" onmouseout="this.style.borderColor='#1e2433'">
                    <img id="${ssId}" src="" alt="Thumbnail" style="width:100%;height:100%;object-fit:cover;display:none">
                    <div id="${ssId}_icon" style="font-size:24px;opacity:0.5">🖼</div>
                </div>`;
                
                // Load thumbnail asynchronously
                setTimeout(async () => {
                    try {
                        const base64 = await window.electronAPI.readScreenshot(ss.path);
                        const img = document.getElementById(ssId);
                        const icon = document.getElementById(ssId + '_icon');
                        if (img && base64) {
                            img.src = `data:image/png;base64,${base64}`;
                            img.style.display = 'block';
                            if (icon) icon.style.display = 'none';
                        }
                    } catch (e) {
                        console.error("Failed to load thumbnail:", e);
                    }
                }, 10);
            });
            h += '</div></div>';
        }
    }

    const allLogsText = e.allLines.map((l, i) => {
        const ln = (e.lineNumbers && e.lineNumbers[i]) ? e.lineNumbers[i] : (i + 1);
        return `L${ln}  ${l}`;
    }).join('\n');

    h += `<div class="section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div class="sec-title" style="color:#94a3b8;margin:0">All Valid Logs (${e.allLines.length} lines)</div><button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="copyToClipboard('${allLogsText.replace(/'/g, "\\'").replace(/\n/g, '\\n')}')">📋 Copy All</button></div><div class="log-box">${e.allLines.map((l, i) => {
        const lineNum = (e.lineNumbers && e.lineNumbers[i]) ? e.lineNumbers[i] : (i + 1);
        return `<span style="color:#334155;min-width:40px;display:inline-block;text-align:right;margin-right:10px;user-select:none">L${lineNum}</span>${makeClickable(stripTs(l))}`;
    }).join('<br>')}</div></div></div></div>`;

    let detailContainer = document.getElementById('detailWindowContainer');
    if (!detailContainer) {
        detailContainer = document.createElement('div');
        detailContainer.id = 'detailWindowContainer';
        detailContainer.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:999;background:#080a10;overflow-y:auto';
        document.body.appendChild(detailContainer);
    }
    detailContainer.innerHTML = h;
}

async function showDetail(idx) {
    const e = filteredData[idx];
    if (!e) return;

    let h = `<div class="modal-hdr"><div><div style="font-size:18px;font-weight:700">Utterance Detail</div><div style="font-size:13px;color:#64748b;margin-top:2px">${esc(e.utterance)}</div></div><button class="modal-close" onclick="closeModal()">✕</button></div>`;
    h += '<div class="modal-content"><div class="meta-grid">';

    [{ l: 'Conversation ID', v: e.conversationId, ck: 'conversationId' }, { l: 'Request ID', v: e.requestId, ck: 'requestId' }, { l: 'Utterance', v: e.utterance }, { l: 'Result', v: e.result, b: 1 }].forEach(m => {
        h += `<div class="meta-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div class="meta-label">${m.l}</div>`;
        if (m.l === 'Conversation ID' && m.v) {
            h += `<button class="btn btn-ghost" style="padding:2px 6px;font-size:10px" onclick="copyToClipboard('${m.v.replace(/'/g, "\\'")}')" title="Copy ID">📋 Copy</button>`;
        }
        h += '</div>';
        if (m.b) h += `<span class="badge badge-${m.v}">${m.v}</span>`;
        else if (m.ck && CONFIG && CONFIG.clickable_patterns && CONFIG.clickable_patterns[m.ck] && CONFIG.clickable_patterns[m.ck].url_template && m.v)
            h += `<a href="javascript:void(0)" onclick="openURLExternal('${CONFIG.clickable_patterns[m.ck].url_template.replace('{value}', m.v)}');event.stopPropagation();return false" class="click-link" style="font-size:13px;font-family:Consolas,monospace;word-break:break-all">${esc(m.v)}</a>`;
        else h += `<div class="meta-val">${esc(m.v)}</div>`;
        h += '</div>';
    });
    h += '</div>';

    if (e.successLine) h += `<div class="section"><div class="sec-title" style="color:#34d399">✓ Success Match</div><div class="succ-box">${makeClickable(stripTs(e.successLine))}</div></div>`;
    if (e.failLines.length > 0) h += `<div class="section"><div class="sec-title" style="color:#f87171">✗ Failure Matches</div><div class="fail-box">${e.failLines.map(l => makeClickable(stripTs(l))).join('<br>')}</div></div>`;

    if (Object.keys(e.patternGroups).length > 0) {
        h += '<div class="section"><div class="sec-title" style="color:#60dcfa">Pattern Groups</div>';
        for (const [, g] of Object.entries(e.patternGroups)) {
            const groupText = g.lines.join('\n');
            h += `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center"><div class="grp-name">${esc(g.name)}</div><button class="btn btn-ghost" style="padding:4px 8px;font-size:10px" onclick="copyToClipboard('${groupText.replace(/'/g, "\\'").replace(/\n/g, '\\n')}')" title="Copy">📋 Copy</button></div><div class="log-box" style="max-height:200px">${g.lines.map(l => makeClickable(stripTs(l))).join('<br>')}</div></div>`;
        }
        h += '</div>';
    }

    if (window.electronAPI && currentFilePath) {
        const screenshots = await window.electronAPI.getScreenshots({ 
            logFilePath: currentFilePath, 
            utterance: e.utterance 
        });
        if (screenshots && screenshots.length > 0) {
            h += '<div class="section"><div class="sec-title" style="color:#a78bfa">📸 Screenshots</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-top:8px">';
            screenshots.forEach((ss, idx) => {
                const ssId = `ss_${idx}_${Date.now()}`;
                h += `<div style="cursor:pointer;border:1px solid #1e2433;border-radius:6px;overflow:hidden;aspect-ratio:1;background:#0a0d14;display:flex;align-items:center;justify-content:center;transition:all 0.2s" onclick="showScreenshotViewer('${ss.path.replace(/'/g, "\\'")}')" title="${esc(ss.name)}" onmouseover="this.style.borderColor='#a78bfa'" onmouseout="this.style.borderColor='#1e2433'">
                    <img id="${ssId}" src="" alt="Thumbnail" style="width:100%;height:100%;object-fit:cover;display:none">
                    <div id="${ssId}_icon" style="font-size:24px;opacity:0.5">🖼</div>
                </div>`;
                
                // Load thumbnail asynchronously
                setTimeout(async () => {
                    try {
                        const base64 = await window.electronAPI.readScreenshot(ss.path);
                        const img = document.getElementById(ssId);
                        const icon = document.getElementById(ssId + '_icon');
                        if (img && base64) {
                            img.src = `data:image/png;base64,${base64}`;
                            img.style.display = 'block';
                            if (icon) icon.style.display = 'none';
                        }
                    } catch (e) {
                        console.error("Failed to load thumbnail:", e);
                    }
                }, 10);
            });
            h += '</div></div>';
        }
    }

    const allLogsText = e.allLines.map((l, i) => {
        const ln = (e.lineNumbers && e.lineNumbers[i]) ? e.lineNumbers[i] : (i + 1);
        return `L${ln}  ${l}`;
    }).join('\n');

    h += `<div class="section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div class="sec-title" style="color:#94a3b8;margin:0">All Valid Logs (${e.allLines.length} lines)</div><button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="copyToClipboard('${allLogsText.replace(/'/g, "\\'").replace(/\n/g, '\\n')}')">📋 Copy All</button></div><div class="log-box">${e.allLines.map((l, i) => {
        const lineNum = (e.lineNumbers && e.lineNumbers[i]) ? e.lineNumbers[i] : (i + 1);
        return `<span style="color:#334155;min-width:40px;display:inline-block;text-align:right;margin-right:10px;user-select:none">L${lineNum}</span>${makeClickable(stripTs(l))}`;
    }).join('<br>')}</div></div></div>`;

    document.getElementById('modalContent').innerHTML = h;
    document.getElementById('modal').classList.add('open');
}

function closeModal() { document.getElementById('modal').classList.remove('open'); }

// ── Screenshots ──
async function showScreenshotViewer(filePath) {
    if (!window.electronAPI) return;
    const base64 = await window.electronAPI.readScreenshot(filePath);
    if (!base64) { showErrorToast('Failed to load screenshot'); return; }
    screenshotViewerScale = 1;
    document.getElementById('screenshotImage').src = `data:image/png;base64,${base64}`;
    document.getElementById('screenshotImage').style.transform = 'scale(1)';
    document.getElementById('zoomLevel').textContent = '100%';
    document.getElementById('screenshotViewer').classList.add('open');
}

function closeScreenshotViewer() { document.getElementById('screenshotViewer').classList.remove('open'); }

function changeScreenshotZoom(delta) { screenshotViewerScale = Math.min(Math.max(0.2, screenshotViewerScale + delta), 3); updateScreenshotZoom(); }

function resetScreenshotZoom() { screenshotViewerScale = 1; updateScreenshotZoom(); }

function updateScreenshotZoom() {
    const img = document.getElementById('screenshotImage');
    img.style.transform = `scale(${screenshotViewerScale})`;
    document.getElementById('zoomLevel').textContent = Math.round(screenshotViewerScale * 100) + '%';
}

function screenshotWheel(e) { if (e.ctrlKey) { e.preventDefault(); changeScreenshotZoom(e.deltaY < 0 ? 0.1 : -0.1); } }

// ── Export Logic ──
async function doExport() {
    const st = { total: entries.length, success: entries.filter(e => e.result === 'SUCCESS').length, fail: entries.filter(e => e.result === 'FAIL').length, partial: entries.filter(e => e.result === 'PARTIAL').length, unknown: entries.filter(e => e.result === 'Unknown').length };
    st.passRate = (st.success + st.fail) > 0 ? ((st.success / (st.success + st.fail)) * 100).toFixed(1) : '-';
    const data = entries.map(e => ({
        conversationId: e.conversationId, requestId: e.requestId, utterance: e.utterance, result: e.result,
        successLine: e.successLine ? stripTs(e.successLine) : null, failLines: e.failLines.map(stripTs), 
        allLines: e.allLines.map(stripTs), lineNumbers: e.lineNumbers,
        patternGroups: Object.fromEntries(Object.entries(e.patternGroups).map(([k, v]) => [k, { name: v.name, lines: v.lines.map(stripTs) }]))
    }));
    const jsonStr = JSON.stringify({ config: { table_columns: CONFIG.table_columns, clickable_patterns: CONFIG.clickable_patterns }, stats: st, entries: data });
    let baseName = (currentFileName || 'report').replace(/\.[^.]+$/, '');
    if (currentFileName === 'clipboard-paste') {
        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        baseName = `${timestamp}_Clipboard`;
    }

    const reportHtml = generateReportHtml();
    if (window.electronAPI) {
        await window.electronAPI.saveExport({ jsonData: jsonStr, htmlData: reportHtml, baseName });
    } else {
        const jBlob = new Blob([jsonStr], { type: 'application/json' });
        const jA = document.createElement('a'); jA.href = URL.createObjectURL(jBlob); jA.download = `${baseName}_data.json`; jA.click();
        setTimeout(() => {
            const hBlob = new Blob([reportHtml], { type: 'text/html' });
            const hA = document.createElement('a'); hA.href = URL.createObjectURL(hBlob); hA.download = `${baseName}_report.html`; hA.click();
        }, 500);
    }
}

function generateReportHtml() {
    const ver = APP_VERSION ? `[${APP_VERSION}] by SimpsonYS` : '';
    // This part is very long, but kept for compatibility.
    // Ideally this would be in a separate template file.
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Voice Interaction Log Report</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#080a10;color:#e2e8f0;font-family:'Segoe UI',system-ui,sans-serif;padding:20px}
.hdr{border-bottom:1px solid #1e2433;padding:16px 0 12px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
.title{font-size:18px;font-weight:700}.sub{font-size:12px;color:#4a5568;margin-top:2px}
.stats{display:flex;gap:8px;flex-wrap:wrap}.stat{background:#0f1117;border:1px solid #1e2433;border-radius:8px;padding:6px 14px;display:flex;align-items:center;gap:8px}
.stat b{font-size:18px;font-weight:700;font-family:monospace}.stat span{font-size:11px;color:#64748b}
.si{background:#0f1117;border:1px solid #1e2433;border-radius:8px;padding:8px 14px;color:#e2e8f0;font-size:13px;width:280px;outline:none;margin-bottom:12px}
.tw{background:#0b0e15;border:1px solid #1e2433;border-radius:12px;overflow:hidden}
table{width:100%;border-collapse:collapse;font-size:12px}th{background:#0f1219;border-bottom:1px solid #1e2433;padding:10px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.8px;cursor:pointer;user-select:none}
td{padding:10px 12px;border-bottom:1px solid #141822;font-family:monospace;color:#94a3b8;max-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
tr.dr:hover{background:#111625}.badge{display:inline-block;padding:2px 10px;border-radius:4px;font-size:11px;font-weight:700;font-family:monospace;letter-spacing:.5px}
.badge-SUCCESS{background:#0d3b24;color:#34d399;border:1px solid #166534}.badge-FAIL{background:#3b0d0d;color:#f87171;border:1px solid #7f1d1d}
.badge-PARTIAL{background:#3b2e0d;color:#fbbf24;border:1px solid #78350f}.badge-Unknown{background:#1e1e2e;color:#94a3b8;border:1px solid #334155}
.utt{color:#60dcfa;text-decoration:underline;cursor:pointer}.cl{color:#60dcfa;text-decoration:underline;cursor:pointer}
.mo{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.7);display:none;justify-content:center;padding:40px 20px;overflow-y:auto}
.mo.op{display:flex}.mb{background:#0f1117;border:1px solid #1e2433;border-radius:12px;width:100%;max-width:1100px;height:fit-content}
.mh{padding:20px 28px;border-bottom:1px solid #1e2433;display:flex;justify-content:space-between;align-items:center}
.cb{background:#1e2433;border:none;color:#94a3b8;font-size:18px;cursor:pointer;border-radius:8px;width:36px;height:36px}
.mg{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:24px}
.mc{background:#161b26;border-radius:8px;padding:12px 16px;border:1px solid #1e2433}.ml{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:4px}
.mv{font-size:13px;color:#e2e8f0;font-family:monospace;word-break:break-all}.gn{font-size:11px;color:#a78bfa;font-weight:600;background:#1e1640;display:inline-block;padding:2px 10px;border-radius:4px;margin-bottom:4px}
.lb{background:#0a0d14;border:1px solid #1e2433;border-radius:6px;padding:10px 14px;max-height:400px;overflow-y:auto;font-family:monospace;font-size:12px;line-height:20px;white-space=pre-wrap;word-break=break-all;color:#94a3b8}
.sb2{background:#0d3b24;border:1px solid #166534;border-radius:6px;padding:8px 12px;font-family:monospace;font-size:12px;color:#e2e8f0;white-space:pre-wrap;word-break:break-all}
.fb{background:#3b0d0d;border:1px solid #7f1d1d;border-radius:6px;padding:8px 12px;font-family:monospace;font-size:12px;color:#e2e8f0;white-space:pre-wrap;word-break:break-all}
.se{margin-bottom:20px}.st{font-size=12px;font-weight=700;margin-bottom:6px;text-transform=uppercase;letter-spacing=1px}
.fp{border:2px dashed #1e2433;border-radius:12px;padding:40px;text-align:center;cursor:pointer;margin-bottom:20px}.fp:hover{border-color:#60dcfa}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:#0f1117}::-webkit-scrollbar-thumb{background:#2a3040;border-radius:3px}</style></head>
<body><div class="hdr"><div><div class="title">Voice Interaction Log Report</div><div class="sub" id="fs">${ver}</div></div><div class="stats" id="sb"></div></div>
<div class="fp" id="fp" onclick="document.getElementById('ji').click()"><p style="color:#94a3b8;font-size:14px;margin-bottom:8px">Click to load the report JSON data file</p>
<p style="color:#4a5568;font-size:12px">Select the _data.json exported with this HTML</p><input type="file" id="ji" accept=".json" style="display:none" onchange="loadJ(this.files[0])"></div>
<input class="si" id="si" placeholder="Search all columns..." oninput="rt()" style="display:none">
<div id="tw" class="tw" style="display:none"><table><thead id="th"></thead><tbody id="tb"></tbody></table></div>
<div id="md" class="mo" onclick="cm()"><div class="mb" onclick="event.stopPropagation()" id="mc2"></div></div>
<script>let D,C,S,sc2=null,sd2='asc',fD2;
function esc2(s){return s?s.replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>'):'N/A'}
function mkC(t){if(!C||!t)return esc2(t);let r=esc2(t);for(const[,c]of Object.entries(C.clickable_patterns)){try{const re=new RegExp(c.pattern,'g');r=r.replace(re,(m,v)=>c.url_template?'<a href="'+c.url_template.replace('{value}',v)+'" target="_blank" style="color:#60dcfa;text-decoration:underline">'+m+'</a>':'<span style="color:#a8e6cf;font-weight:600">'+m+'</span>')}catch(e){}}return r}
function loadJ(f){const r=new FileReader();r.onload=e=>{try{const d=JSON.parse(e.target.result);D=d.entries;C=d.config;S=d.stats;init2()}catch(x){showErrorToast('Invalid JSON: '+x.message)}};r.readAsText(f)}
function init2(){document.getElementById('fp').style.display='none';document.getElementById('si').style.display='';document.getElementById('tw').style.display='';
document.getElementById('fs').textContent=D.length+' utterances';
document.getElementById('sb').innerHTML=[{l:'Total',v:S.total,c:'#60dcfa'},{l:'Success',v:S.success,c:'#34d399'},{l:'Fail',v:S.fail,c:'#f87171'},{l:'Partial',v:S.partial,c:'#fbbf24'},{l:'Unknown',v:S.unknown,c:'#94a3b8'},{l:'Pass Rate',v:S.passRate+'%',c:'#a78bfa'}].map(s=>'<div class="stat"><b style="color:'+s.c+'">'+s.v+'</b><span>'+s.l+'</span></div>').join('');
document.getElementById('th').innerHTML='<tr>'+C.table_columns.map(c=>"<th onclick=\\"ds2('"+c.key+"')\\">"+c.label+'</th>').join('')+'</tr>';rt()}
function ds2(c){if(sc2===c)sd2=sd2==='asc'?'desc':'asc';else{sc2=c;sd2='asc'}rt()}
function gf2(){const q=(document.getElementById('si').value||'').toLowerCase();let r=D.filter(e=>!q||Object.values(e).some(v=>(v||'').toString().toLowerCase().includes(q)));if(sc2)r=[...r].sort((a,b)=>{const va=(a[sc2]||'').toString().toLowerCase(),vb=(b[sc2]||'').toString().toLowerCase();return sd2==='asc'?va.localeCompare(vb):vb.localeCompare(va)});fD2=r;return r}
function rt(){const rows=gf2();const cols=C.table_columns;
document.getElementById('tb').innerHTML=rows.map((e,i)=>'<tr class="dr" style="cursor:pointer" onclick="sd3('+i+')">'+cols.map(c=>{const v=e[c.key]||'N/A';
if(c.type==='badge')return'<td><span class="badge badge-'+v+'">'+v+'</span></td>';if(c.type==='utterance')return'<td><span class="utt">'+esc2(v)+'</span></td>';
if(c.clickable_key&&C.clickable_patterns[c.clickable_key]){const cp=C.clickable_patterns[c.clickable_key];if(cp.url_template&&v!=='N/A')return'<td><a class="cl" href="'+cp.url_template.replace('{value}',v)+'" target="_blank" onclick="event.stopPropagation()">'+esc2(v)+'</a></td>'}
if(c.type==='log')return'<td>'+mkC(v)+'</td>';return'<td>'+esc2(v)+'</td>'}).join('')+'</tr>').join('')}
function sd3(i){const e=fD2[i];if(!e)return;let h='<div class="mh"><div><div style="font-size:18px;font-weight:700">Utterance Detail</div><div style="font-size:13px;color:#64748b;margin-top:2px">'+esc2(e.utterance)+'</div></div><button class="cb" onclick="cm()">✕</button></div><div style="padding:20px 28px"><div class="mg">';
[{l:'Conversation ID',v:e.conversationId,ck:'conversationId'},{l:'Request ID',v:e.requestId,ck:'requestId'},{l:'Utterance',v:e.utterance},{l:'Result',v:e.result,b:1}].forEach(m=>{
h+='<div class="mc"><div class="ml">'+m.l+'</div>';if(m.b)h+='<span class="badge badge-'+m.v+'">'+m.v+'</span>';
else if(m.ck&&C.clickable_patterns[m.ck]&&C.clickable_patterns[m.ck].url_template&&m.v)h+='<a href="'+C.clickable_patterns[m.ck].url_template.replace('{value}',m.v)+'" target="_blank" style="color:#60dcfa;text-decoration:underline;font-size:13px;font-family:monospace;word-break:break-all">'+esc2(m.v)+'</a>';
else h+='<div class="mv">'+esc2(m.v)+'</div>';h+='</div>'});h+='</div>';
if(e.successLine)h+='<div class="se"><div class="st" style="color:#34d399">✓ Success Match</div><div class="sb2">'+mkC(e.successLine)+'</div></div>';
if(e.failLines&&e.failLines.length)h+='<div class="se"><div class="st" style="color:#f87171">✗ Failure Matches</div><div class="fb">'+e.failLines.map(l=>mkC(l)).join('<br>')+'</div></div>';
if(e.patternGroups&&Object.keys(e.patternGroups).length){h+='<div class="se"><div class="st" style="color:#60dcfa">Pattern Groups</div>';for(const[,g]of Object.entries(e.patternGroups))h+='<div style="margin-bottom:12px"><div class="gn">'+esc2(g.name)+'</div><div class="lb" style="max-height:200px">'+g.lines.map(l=>mkC(l)).join('<br>')+'</div></div>';h+='</div>'}
h+='<div class="se"><div class="st" style="color:#94a3b8">All Valid Logs ('+e.allLines.length+' lines)</div><div class="lb">'+e.allLines.map((l,i)=>{const ln=(e.lineNumbers&&e.lineNumbers[i])?e.lineNumbers[i]:(i+1);return '<span style="color:#334155;min-width:30px;display:inline-block;text-align:right;margin-right:10px;user-select:none">L'+ln+'</span>'+mkC(l)}).join('<br>')+'</div></div></div>';
document.getElementById('mc2').innerHTML=h;document.getElementById('md').classList.add('op')}
function cm(){document.getElementById('md').classList.remove('op')}
document.addEventListener('keydown',e=>{if(e.key==='Escape')cm()});
<\/script></body></html>`;
}

function resetApp() {
    entries = []; filteredData = []; sortCol = null; sortDir = 'asc'; currentFileName = null; currentFilePath = null; currentEncoding = null; currentRawText = null;
    document.getElementById('dropzone').style.display = ''; 
    document.getElementById('resultsArea').style.display = 'none'; 
    document.getElementById('exportBtn').style.display = 'none';
    document.getElementById('refreshBtn').style.display = 'none';
    
    const pp = document.getElementById('progressPanel'); 
    if (pp) pp.classList.remove('show');
    
    const pl = document.getElementById('progressLayout'); 
    if (pl) pl.style.display = 'block';

    const psl = document.getElementById('progressSplitLayout'); 
    if (psl) psl.style.display = 'none';
}

// ── Updates ──
let updateState = null;
async function checkForUpdates() {
    showUpdateModal('Checking for updates...', 'checking');
    if (window.electronAPI && window.electronAPI.checkUpdates) {
        try { await window.electronAPI.checkUpdates(); } catch (e) { console.error('Update check error:', e); showUpdateModal('Update check failed', 'error'); }
    } else { showUpdateModal('Update check not available in this version', 'error'); }
}

function showUpdateModal(message, state) {
    updateState = state;
    const modal = document.getElementById('updateModal');
    const content = document.getElementById('updateContent');
    const actionBtn = document.getElementById('updateActionBtn');
    if (actionBtn) actionBtn.style.display = 'none';

    let html = '';
    if (state === 'checking') html = `<div style="text-align:center;padding:40px 20px"><div style="font-size:14px;color:#94a3b8">Checking for updates...</div><div style="margin-top:16px;animation:pulse 1s infinite">⏳</div></div>`;
    else if (state === 'uptodate') html = `<div style="text-align:center;padding:40px 20px"><div style="font-size:18px;margin-bottom:8px">✓</div><div style="font-size:14px;color:#94a3b8">${message}</div></div>`;
    else if (state === 'downloading') html = `<div style="text-align:center;padding:20px"><div style="font-size:14px;color:#94a3b8;margin-bottom:12px">${message}</div><div style="animation:pulse 1s infinite">⬇️</div></div>`;
    else if (state === 'ready') { html = `<div style="text-align:center;padding:40px 20px"><div style="font-size:18px;margin-bottom:8px">🎉</div><div style="font-size:14px;color:#94a3b8">${message}</div></div>`; if (actionBtn) actionBtn.style.display = 'block'; }
    else if (state === 'error') html = `<div style="text-align:center;padding:40px 20px"><div style="font-size:18px;margin-bottom:8px">⚠️</div><div style="font-size:14px;color:#f87171">${message}</div></div>`;

    if (content) content.innerHTML = html;
    if (modal) modal.classList.add('open');
}

function closeUpdateModal() { const modal = document.getElementById('updateModal'); if (modal) modal.classList.remove('open'); }

async function handleUpdateAction() { if (updateState === 'ready' && window.electronAPI && window.electronAPI.installUpdate) { window.electronAPI.installUpdate(); } }

async function openConfigFolder() {
    if (window.electronAPI) { await window.electronAPI.openConfigFolder(); }
    else { showErrorToast('Config file is embedded in the application. Use the Electron desktop version to customize config.'); }
}

// ── Boot ──
document.addEventListener('DOMContentLoaded', init);
