/**
 * renderer.js - Main logic for Voice Interaction Log Analyzer
 */

// ── State ──
function injectTcColumn(config) {
    if (!config || !config.table_columns) return config;
    const hasTc = config.table_columns.some(c => c.key === '_tc_num');
    if (!hasTc) {
        const convCol = config.table_columns.find(c => c.key === 'conversationId');
        if (convCol && convCol.width === '22%') convCol.width = '14%';
        
        config.table_columns.unshift({
            key: "_tc_num",
            label: "TC No.",
            width: "8%",
            type: "tc"
        });
    }
    return config;
}

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
let streamingMode = true; // streaming analysis mode (false = wait until complete, true = show results in real-time)
let currentConfigFileName = null; // currently active preset config filename
let isLiveStreaming = false;
let screenshotSavePath = null;

// Streaming state
let streamLineBuffer = "";
let streamLineCount = 0;
let streamFoundCount = 0;
let streamMatchedCount = 0;
let streamBlockBuffer = [];
let streamBlockLineNumbers = [];
let streamInBlock = false;
let streamStartPatterns = null;
let streamEndPatterns = null;
let streamTotalBytes = 0;
let streamBytesProcessed = 0;

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

// In init()
    if (window.electronAPI) {
        // Listen for file content loaded from the main process
        if (window.electronAPI.onFileContentLoaded) {
            window.electronAPI.onFileContentLoaded((data) => {
                if (data.success) {
                    logToFile('info', 'File metadata received from main process.', { fileName: data.fileName, streaming: data.isStreaming });
                    currentFilePath = data.filePath;
                    currentFileName = data.fileName;
                    currentEncoding = data.encoding;
                    currentFilePath_base = data.fileName.replace(/\.[^.]*$/, '');
                    
                    if (data.isStreaming) {
                        prepareStreamingParsing(data.fileName, data.encoding, data.fileSize);
                    } else {
                        currentRawText = data.content;
                        startParsing(data.content, data.fileName, data.encoding);
                    }
                } else {
                    showErrorToast(`Failed to load file: ${data.reason}`, data.stack);
                }
            });
        }

        if (window.electronAPI.onFileDataChunk) {
            window.electronAPI.onFileDataChunk((chunk) => {
                handleStreamingChunk(chunk);
            });
        }

        if (window.electronAPI.onFileReadComplete) {
            window.electronAPI.onFileReadComplete(() => {
                finishStreamingParsing();
            });
        }

        if (window.electronAPI.onFileReadError) {
            window.electronAPI.onFileReadError((error) => {
                showErrorToast(`File read error: ${error}`);
                isAnalyzing = false;
            });
        }

        // Live Log Stream listeners
        if (window.electronAPI.onLogStreamData) {
            window.electronAPI.onLogStreamData(handleStreamingChunk);
        }
        if (window.electronAPI.onLogStreamError) {
            window.electronAPI.onLogStreamError((error) => {
                showErrorToast(`Live stream error: ${error}`);
                toggleLiveStream(); // Stop the stream on error
            });
        }
        if (window.electronAPI.onLogStreamClosed) {
            window.electronAPI.onLogStreamClosed((code) => {
                showToast(`Live stream stopped (code: ${code}).`);
                if (isLiveStreaming) {
                    toggleLiveStream(); // Ensure UI is updated
                }
            });
        }

        
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
                CONFIG = injectTcColumn(result.config);
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

    // In init()
    if (window.electronAPI) {
        // ... (existing listeners)
    }
    // ...

    // Fallback: ensure CONFIG is never null
    if (!CONFIG) {
        CONFIG = getDefaultConfig();
        console.log("Using default config (fallback)");
    }
    
    updateDefaultCommands(); // Set initial commands
    initColumnFilters();
    setupEventListeners();
}

// ...

function updateDefaultCommands() {
    const deviceId = document.getElementById('sdbDeviceInput').value;
    if (!deviceId) return;

    // Update Live Log Command
    const liveLogCommandInput = document.getElementById('liveLogCommand');
    liveLogCommandInput.value = `sdb -s ${deviceId} shell dlogutil -v VOICE_CLIENT`;

    // Update Screenshot Command
    const screenshotCommandTextarea = document.getElementById('screenshotCommand');
    screenshotCommandTextarea.value = `sdb -s ${deviceId} shell rm -rf /tmp/dump_screen.png
sdb -s ${deviceId} shell enlightenment_info -dump_screen
sdb -s ${deviceId} pull /tmp/dump_screen.png yymmdd_hhmmss.png`;
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
    if (isAnalyzing) {
        const shouldContinue = confirm('현재 로그 분석이 진행 중입니다. 분석을 취소하고 새로운 패턴으로 다시 분석하시겠습니까?');
        if (!shouldContinue) {
            updatePresetRadioSelection(currentConfigFileName); // Revert selection
            return;
        }
        parseInterrupt = true;
    }

    if (!window.electronAPI || !window.electronAPI.switchPreset) {
        showErrorToast('switchPreset API not available');
        return;
    }
    try {
        const result = await window.electronAPI.switchPreset(fileName);
        if (result && result.config) {
            CONFIG = injectTcColumn(result.config);
            currentConfigFileName = result.fileName || fileName;
            updatePresetRadioSelection(currentConfigFileName);
            console.log('Switched to preset:', currentConfigFileName);

            // Re-analyze current file if loaded
            if (currentFileName) {
                // Clear existing results before re-analysis
                entries = [];
                filteredData = [];
                document.getElementById('tableBody').innerHTML = '';
                document.getElementById('tableHead').innerHTML = '';
                document.getElementById('tableFilters').innerHTML = '';
                document.getElementById('statsBar').innerHTML = '';
                initColumnFilters();

                if (currentFilePath && window.electronAPI.openAndReadFile) {
                    window.electronAPI.openAndReadFile(currentFilePath);
                } else if (currentRawText) {
                    startParsing(currentRawText, currentFileName, currentEncoding || 'utf-8');
                }
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
    return injectTcColumn({
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
    });
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

    // In setupEventListeners()
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

    const sdbDeviceInput = document.getElementById('sdbDeviceInput');
    if (sdbDeviceInput) {
        sdbDeviceInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                updateDefaultCommands();
            }
        });
        sdbDeviceInput.addEventListener('blur', updateDefaultCommands);
    }

    const screenshotFolderBtn = document.getElementById('screenshotFolderBtn');
    if (screenshotFolderBtn) {
        screenshotFolderBtn.addEventListener('click', selectScreenshotFolder);
    }

    const screenshotBtn = document.getElementById('screenshotBtn');
    if (screenshotBtn) {
        screenshotBtn.addEventListener('click', takeScreenshot);
    }



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
    if (!isLiveStreaming) {
        document.getElementById('dropzone').style.display = 'none';
    }
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
    document.getElementById('tableHead').innerHTML = '';
    document.getElementById('tableFilters').innerHTML = '';
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
    if (isAnalyzing) {
        const shouldContinue = confirm('Analysis in progress. Cancel and open new file?');
        if (!shouldContinue) return;
        parseInterrupt = true;
    }

    if (window.electronAPI && window.electronAPI.openAndReadFile) {
        try {
            logToFile('info', 'Requesting main process to open file dialog.');
            showLoadingState("..."); // Show a generic loading state
            updateLoadingState('Waiting for file selection...');
            const result = await window.electronAPI.openAndReadFile();
            if (result && !result.success && result.reason !== 'Canceled') {
                showErrorToast(`Error during file open: ${result.reason}`, result.stack);
            }
        } catch (err) {
            showErrorToast(`An IPC error occurred: ${err.message}`, err.stack);
            logToFile('error', 'IPC invoke for openAndReadFile failed', err);
        }
    } else {
        // Fallback for non-electron environment (won't work well with large files)
        logToFile('warn', 'Non-Electron environment, using browser file reader.');
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.log,.txt,.text';
        input.onchange = () => {
            if (input.files[0]) {
                const file = input.files[0];
                showLoadingState(file.name);
                const reader = new FileReader();
                reader.onload = e => {
                    logToFile('info', 'File read with browser FileReader.');
                    processText(e.target.result, file.name)
                };
                reader.onerror = () => {
                    const err = reader.error;
                    showErrorToast(`File reading error: ${err.name}`, err.message);
                    logToFile('error', 'FileReader failed', err);
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }
}



function readFile(file) {
    if (!file) return;
    logToFile('info', 'readFile called for file.', { name: file.name, path: file.path, size: file.size, type: file.type });
    if (window.electronAPI && window.electronAPI.openAndReadFile && file.path) {
        logToFile('info', 'File dropped, using streaming reader.', { path: file.path });
        window.electronAPI.openAndReadFile(file.path);
    } else {
        logToFile('warn', 'File dropped, but file.path not available or not in Electron. Falling back to FileReader.');
        showLoadingState(file.name);
        const reader = new FileReader();
        reader.onload = (e) => {
            logToFile('info', 'File read from drop event (fallback).');
            processText(e.target.result, file.name);
        };
        reader.onerror = () => {
            const err = reader.error;
            showErrorToast(`File reading error: ${err.name}`, err.message);
            logToFile('error', 'FileReader failed on drop', err);
        };
        reader.readAsText(file);
    }
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



function stripTs(line) {
    const m = line.match(/[A-Z]\/[\w]+\s*\(\s*\d+\)\s*:/);
    return m ? line.substring(m.index) : line;
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
    if (!currentFileName) { alert('분석된 파일이 없습니다.'); return; }
    if (isAnalyzing) { alert('현재 분석 중입니다.'); return; }
    if (window.electronAPI && window.electronAPI.loadConfig) {
        const nc = await window.electronAPI.loadConfig();
        if (nc && nc.config) { CONFIG = injectTcColumn(nc.config); currentConfigFileName = nc.fileName; }
        else if (nc) CONFIG = injectTcColumn(nc);
    }
    initColumnFilters();
    document.getElementById('tableFilters').innerHTML = '';
    
    if (currentFilePath && window.electronAPI && window.electronAPI.openAndReadFile) {
        window.electronAPI.openAndReadFile(currentFilePath);
    } else if (currentRawText) {
        startParsing(currentRawText, currentFileName, currentEncoding || 'utf-8');
    }
}

// ── Streaming Parsing ──
function prepareStreamingParsing(name, enc, fileSize) {
    entries = [];
    parseInterrupt = false;
    isAnalyzing = true;
    sortCol = null;
    sortDir = 'asc';
    sortState = {};
    const searchBox = document.getElementById('searchBox');
    if (searchBox) searchBox.value = '';
    initColumnFilters();
    showProgress(name, enc);

    streamLineBuffer = "";
    streamLineCount = 0;
    streamFoundCount = 0;
    streamMatchedCount = 0;
    streamBlockBuffer = [];
    streamBlockLineNumbers = [];
    streamInBlock = false;
    streamStartPatterns = new RegExp(CONFIG.start_patterns.join('|'));
    streamEndPatterns = new RegExp(CONFIG.end_patterns.join('|'));
    streamTotalBytes = fileSize || 0;
    streamBytesProcessed = 0;
}

function handleStreamingChunk(chunkData) {
    if (parseInterrupt) {
        if (window.electronAPI && window.electronAPI.cancelFileRead) {
            window.electronAPI.cancelFileRead();
        }
        return;
    }
    
    const text = typeof chunkData === 'string' ? chunkData : chunkData.text;
    const byteLength = typeof chunkData === 'string' ? 0 : chunkData.byteLength;

    // If in live streaming mode, update the raw log viewer
    if (isLiveStreaming) {
        const rawLogContent = document.getElementById('rawLogContent');
        if (rawLogContent) {
            rawLogContent.textContent += text;
            // Keep the log from getting too long
            const lines = rawLogContent.textContent.split('\n');
            if (lines.length > 500) {
                rawLogContent.textContent = lines.slice(lines.length - 500).join('\n');
            }
            // Auto-scroll to bottom
            rawLogContent.parentElement.scrollTop = rawLogContent.parentElement.scrollHeight;
        }
    }
    
    streamBytesProcessed += byteLength;

    // SDB literal \n normalization: convert backslash+n before timestamps to real newlines
    let normText = text;
    if (normText.includes('\\n')) {
        normText = normText.replace(/\\n(?=\[?\d{2}-\d{2}-\d{4}\s)/g, '\n');
        normText = normText.replace(/\\n(?=\d{4,6}\.\d{1,3}\s+[VDIWEF]\/)/g, '\n');
    }

    streamLineBuffer += normText;
    const lines = streamLineBuffer.split(/\r?\n|\r/);
    
    // Keep the last partial line in the buffer
    streamLineBuffer = lines.pop();
    
    if (lines.length > 0) {
        processStreamLines(lines);
    }
}

function processStreamLines(lines) {
    const SDB_NEWLINE_MARKER_START = /^L\d{1,5}\s/;
    const liveStatusEl = document.getElementById('liveStatus');

    for (const line of lines) {
        streamLineCount++;
        let t = line.trim();
        if (SDB_NEWLINE_MARKER_START.test(t)) {
            t = t.replace(SDB_NEWLINE_MARKER_START, "").trim();
        }
        if (!t) continue;

        const isS = streamStartPatterns.test(t);
        const isE = streamEndPatterns.test(t);

        if (isS) {
            if (streamInBlock && streamBlockBuffer.length > 0) {
                const entry = parseBlock(streamBlockBuffer, streamBlockLineNumbers);
                entries.push(entry);
                streamFoundCount++;
                streamMatchedCount += streamBlockBuffer.length;
                streamBlockBuffer = [];
                streamBlockLineNumbers = [];
                streamInBlock = false;
                if (liveStatusEl) {
                    liveStatusEl.textContent = '';
                }
            }
            streamBlockBuffer = [t];
            streamBlockLineNumbers = [streamLineCount];
            streamInBlock = true;
            if (liveStatusEl) {
                liveStatusEl.textContent = '새로운 발화 분석중...';
                liveStatusEl.style.color = '#fbbf24';
            }
        } else if (isE && streamInBlock) {
            streamBlockBuffer.push(t);
            streamBlockLineNumbers.push(streamLineCount);
            const entry = parseBlock(streamBlockBuffer, streamBlockLineNumbers);
            entries.push(entry);
            streamFoundCount++;
            streamMatchedCount += streamBlockBuffer.length;
            streamBlockBuffer = [];
            streamBlockLineNumbers = [];
            streamInBlock = false;
            if (liveStatusEl) {
                liveStatusEl.textContent = '';
            }
        } else if (streamInBlock) {
            streamBlockBuffer.push(t);
            streamBlockLineNumbers.push(streamLineCount);
        }
    }
    
    // Throttle UI updates for performance if needed, but for now update every chunk
    updateProgress(streamBytesProcessed, streamTotalBytes, streamFoundCount, streamMatchedCount);
}

function finishStreamingParsing() {
    // Process remaining line in buffer
    if (streamLineBuffer) {
        processStreamLines([streamLineBuffer]);
        streamLineBuffer = "";
    }

    // Process remaining block
    if (streamInBlock && streamBlockBuffer.length > 0) {
        const entry = parseBlock(streamBlockBuffer, streamBlockLineNumbers);
        entries.push(entry);
        streamFoundCount++;
        streamMatchedCount += streamBlockBuffer.length;
    }

    finishParsing();
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

    // SDB logs sometimes insert a literal newline followed by 'L' and a line number.
    // This pre-processing step normalizes these into standard newlines.
    const SDB_NEWLINE_MARKER = /\nL\d{1,5}\s/g;
    if (text.includes("\nL")) {
        logToFile('info', 'SDB newline marker (\\nL[number]) detected. Normalizing newlines.');
        text = text.replace(SDB_NEWLINE_MARKER, "\n");
    }

    // SDB literal \n: convert backslash+n before timestamps to real newlines
    if (text.includes('\\n')) {
        text = text.replace(/\\n(?=\[?\d{2}-\d{2}-\d{4}\s)/g, '\n');
        text = text.replace(/\\n(?=\d{4,6}\.\d{1,3}\s+[VDIWEF]\/)/g, '\n');
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
        _tc_num: 'TC' + String(entries.length + 1).padStart(5, '0'),
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
    if (!isLiveStreaming) {
        document.getElementById('dropzone').style.display = 'none';
    }
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
    document.getElementById('tableHead').innerHTML = '';
    document.getElementById('tableFilters').innerHTML = '';
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
    const pct = total > 0 ? (processed / total * 100).toFixed(1) : 0;
    document.getElementById('progressBar').style.width = pct + '%';
    
    // If we're using bytes for processed/total, show them in MB
    if (total > 1000000) {
        document.getElementById('progressCount').textContent = `${(processed / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB`;
    } else {
        document.getElementById('progressCount').textContent = `${processed.toLocaleString()} / ${total.toLocaleString()} lines`;
    }
    
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
    updateDefaultCommands(); // Update commands now that the view is visible
    
    // Show screenshot section ONLY if it's Live Log mode
    if (isLiveStreaming) {
        document.getElementById('screenshotSection').style.display = 'block';
    } else {
        document.getElementById('screenshotSection').style.display = 'none';
    }

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
// Strip control chars that cause "Invalid or unexpected token" in onclick attrs
function sanitizeCtrl(s) { return s ? s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/`/g, "'").replace(/\$/g, '') : ''; }

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

function handleCopyClick(event, textToCopy) {
    event.stopPropagation();
    copyToClipboard(textToCopy);
}

// ── Virtual Scrolling State ──
let vsState = {
    rowHeight: 40, 
    buffer: 10,
    visibleRows: 0,
    scrollTop: 0
};

function initVirtualScroll() {
    const tb = document.getElementById('tableBody');
    if (tb) {
        tb.style.overflowY = 'auto';
        tb.style.position = 'relative';
        tb.style.maxHeight = '600px'; 
        tb.addEventListener('scroll', (e) => {
            vsState.scrollTop = e.target.scrollTop;
            renderVirtualTableBody();
        });
    }
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
            const hasGlobal = (e.conversationId || 'n/a').toLowerCase().includes(q) ||
                (e.requestId || 'n/a').toLowerCase().includes(q) ||
                (e.utterance || 'n/a').toLowerCase().includes(q) ||
                e.result.toLowerCase().includes(q) ||
                (e.successLine || 'n/a').toLowerCase().includes(q);
            if (!hasGlobal) return false;
        }
        for (const [col, filter] of Object.entries(columnFilters)) {
            if (!filter) continue;
            let val = (e[col] || '').toString().toLowerCase();
            if (val === '') val = 'n/a';
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
    
    // Initialize scrolling wrapper once
    initVirtualScroll();
    renderVirtualTableBody();
}

function renderVirtualTableBody() {
    const tb = document.getElementById('tableBody');
    const totalRows = filteredData.length;
    
    if (totalRows === 0) {
        const q = (document.getElementById('searchBox').value || '');
        tb.innerHTML = `<div class="empty-msg">No entries found${q ? ` matching "${esc(q)}"` : ''}</div>`;
        return;
    }
    
    const clientHeight = tb.clientHeight || 600;
    vsState.visibleRows = Math.ceil(clientHeight / vsState.rowHeight);
    const totalHeight = totalRows * vsState.rowHeight;
    
    let startIdx = Math.floor(vsState.scrollTop / vsState.rowHeight) - vsState.buffer;
    startIdx = Math.max(0, startIdx);
    
    let endIdx = startIdx + vsState.visibleRows + (vsState.buffer * 2);
    endIdx = Math.min(totalRows, endIdx);
    
    const gridCols = document.getElementById('tableHead').style.gridTemplateColumns;
    const cols = CONFIG.table_columns;
    
    const rowsHtml = filteredData.slice(startIdx, endIdx).map((e, sliceIdx) => {
        const i = startIdx + sliceIdx;
        const cells = cols.map(c => {
            const v = e[c.key];
            const sanitizedV = sanitizeCtrl(String(v || ''));
            const copyBtn = `<button class="copy-btn" title="Copy" onclick="handleCopyClick(event, '${sanitizedV.replace(/'/g, "\\\\'")}')">📋</button>`;

            if (c.type === 'badge') return `<div class="td"><span class="badge badge-${v}">${v}</span></div>`;
            if (c.type === 'utterance') return `<div class="td"><span class="utt-link" title="Click to detail">${esc(v)}</span>${copyBtn}</div>`;
            if (c.type === 'log' && v) {
                const display = extractLogDisplay(v, c.key);
                const lineIdx = e.allLines ? e.allLines.indexOf(v) : -1;
                const lineNum = (lineIdx >= 0 && e.lineNumbers) ? e.lineNumbers[lineIdx] : '';
                const sanitizedDisplay = sanitizeCtrl(String(display || ''));
                const copyBtnLog = `<button class="copy-btn" title="Copy" onclick="handleCopyClick(event, '${sanitizedDisplay.replace(/'/g, "\\\\'")}')">📋</button>`;

                return `<div class="td" title="${esc(v)}"><span>${esc(display)}${lineNum ? ` <span style="color:#334155;font-size:10px">[L${lineNum}]</span>` : ''}</span>${copyBtnLog}</div>`;
            }
            if (c.clickable_key) {
                const cp = CONFIG.clickable_patterns[c.clickable_key];
                if (cp && cp.url_template && v) {
                    return `<div class="td"><a class="click-link" href="javascript:openURLExternal('${cp.url_template.replace('{value}', v)}')" onclick="event.stopPropagation()">${esc(v)}</a>${copyBtn}</div>`;
                }
            }
            return `<div class="td"><span>${esc(v)}</span>${copyBtn}</div>`;
        }).join('');
        return `<div class="tr" style="grid-template-columns:${gridCols};position:absolute;top:${i * vsState.rowHeight}px;left:0;right:0;height:${vsState.rowHeight}px;animation-delay:${Math.min(sliceIdx * 0.015, 0.4)}s" onclick="openDetailFromTable(${i})">${cells}</div>`;
    }).join('');
    
    tb.innerHTML = `<div style="height:${totalHeight}px;position:relative;width:100%">${rowsHtml}</div>`;
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

function toggleLiveStream() {
    const liveLogBtn = document.getElementById('liveLogBtn');
    if (!window.electronAPI) {
        showErrorToast('Live log streaming is only available in the Electron app.');
        return;
    }

    isLiveStreaming = !isLiveStreaming;

    if (isLiveStreaming) {
        // Start the stream
        const command = document.getElementById('liveLogCommand').value;
        if (!command) {
            showErrorToast('Live log command cannot be empty.');
            isLiveStreaming = false; // Reset state
            return;
        }
        window.electronAPI.startLogStream(command);
        liveLogBtn.innerHTML = '■ Stop Live Log';
        liveLogBtn.classList.add('active');

        // Prepare for streaming, but hide the file-based progress UI
        prepareStreamingParsing('SDB Live Log', 'utf-8', 0);
        // Do NOT hide dropzone so user can click 'Stop Live Log'
        document.getElementById('dropzone').style.display = '';
        
        document.getElementById('progressPanel').style.display = 'none';
        document.getElementById('resultsArea').style.display = 'block';
        
        // Show live log viewer
        document.getElementById('rawLogViewer').style.display = 'block';
        document.getElementById('rawLogContent').textContent = '';
        updateDefaultCommands(); // Update commands now that the view is visible
        document.getElementById('screenshotSection').style.display = 'block';

        // Ensure streaming mode is enabled for live analysis
        if (!streamingMode) {
            setStreamingMode(true);
        }

    } else {
        // Stop the stream
        window.electronAPI.stopLogStream();
        liveLogBtn.innerHTML = '🔴 Start Live Log';
        liveLogBtn.classList.remove('active');

        const liveStatusEl = document.getElementById('liveStatus');
        if (liveStatusEl) {
            liveStatusEl.textContent = '';
        }

        // Hide live log viewer
        document.getElementById('rawLogViewer').style.display = 'none';
        document.getElementById('screenshotSection').style.display = 'none';

        // Finalize the UI and show the progress summary
        finishParsing();
        document.getElementById('progressPanel').style.display = 'block';
    }
}

async function selectScreenshotFolder() {
    if (!window.electronAPI) {
        showErrorToast('This feature is only available in the Electron app.');
        return;
    }
    try {
        const path = await window.electronAPI.selectScreenshotFolder();
        if (path) {
            screenshotSavePath = path;
            document.getElementById('screenshotFolder').textContent = `Save path: ${path}`;
        }
    } catch (err) {
        showErrorToast(`Could not select folder: ${err.message}`, err.stack);
    }
}

async function takeScreenshot() {
    if (!screenshotSavePath) {
        showErrorToast('Please select a folder to save the screenshot in.');
        return;
    }
    const command = document.getElementById('screenshotCommand').value;
    if (!command) {
        showErrorToast('Screenshot command cannot be empty.');
        return;
    }

    try {
        const screenshotPath = await window.electronAPI.runScreenshotCommand({ command, savePath: screenshotSavePath });
        if (screenshotPath) {
            showToast('Screenshot saved!');
            const base64 = await window.electronAPI.readScreenshot(screenshotPath);
            if (base64) {
                const container = document.getElementById('screenshotThumbnailContainer');
                container.innerHTML = `<img src="data:image/png;base64,${base64}" style="max-width: 100%; max-height: 100%; border-radius: 8px;">`;
            }
        }
    } catch (err) {
        showErrorToast(`Screenshot failed: ${err.message}`, err.stack);
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

function getAllPatterns(config) {
    const patterns = new Set();
    if (!config) return [];

    // Simple string patterns
    ['start_patterns', 'end_patterns', 'success_patterns', 'failure_patterns'].forEach(key => {
        if (config[key]) {
            config[key].forEach(p => patterns.add(p));
        }
    });

    // Patterns from objects
    if (config.clickable_patterns) {
        Object.values(config.clickable_patterns).forEach(p => {
            if (p.pattern) patterns.add(p.pattern);
        });
    }
    if (config.utterance_patterns) {
        Object.values(config.utterance_patterns).forEach(p => {
            if (p.pattern) patterns.add(p.pattern);
        });
    }

    // Patterns from pattern_groups
    if (config.pattern_groups) {
        Object.values(config.pattern_groups).forEach(g => {
            if (g.patterns) {
                g.patterns.forEach(p => patterns.add(p));
            }
        });
    }
    
    return Array.from(patterns).map(p => {
        try {
            return new RegExp(p);
        } catch (e) {
            console.warn('Invalid regex pattern in config:', p, e);
            return null;
        }
    }).filter(Boolean);
}

async function openDetailFromTable(idx) {
    const e = filteredData[idx];
    if (!e) return;

    // Fallback to modal if not in Electron
    if (!window.electronAPI || !window.electronAPI.openDetailHtml) {
        showDetail(idx); return;
    }

    try {
        const html = await generateDetailHtml(e, idx + 1);
        await window.electronAPI.openDetailHtml(html);
    } catch (err) {
        console.error("Failed to open detail in browser:", err);
        showDetail(idx);
    }
}

async function generateDetailHtml(e, utteranceIndex) {
    const escH = s => s ? s.toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : 'N/A';

    // Build clickable pattern renderer for the standalone page
    let clickableScript = '';
    if (CONFIG && CONFIG.clickable_patterns) {
        const pats = {};
        for (const [k, c] of Object.entries(CONFIG.clickable_patterns)) {
            pats[k] = { pattern: c.pattern, url_template: c.url_template || null };
        }
        clickableScript = `const CP=${JSON.stringify(pats)};
function mkC(t){if(!t)return esc(t);let r=esc(t);for(const[,c]of Object.entries(CP)){try{const re=new RegExp(c.pattern,'g');r=r.replace(re,(m,v)=>c.url_template?'<a href="'+c.url_template.replace('{value}',v)+'" target="_blank" style="color:#60dcfa;text-decoration:underline">'+m+'</a>':'<span style="color:#a8e6cf;font-weight:600">'+m+'</span>')}catch(e){}}return r}`;
    } else {
        clickableScript = `function mkC(t){return esc(t)}`;
    }

    // Meta cards
    let metaHtml = '';
    const metas = [
        { l: 'Conversation ID', v: e.conversationId, ck: 'conversationId' },
        { l: 'Request ID', v: e.requestId, ck: 'requestId' },
        { l: 'Utterance', v: e.utterance },
        { l: 'Result', v: e.result, b: true }
    ];
    for (const m of metas) {
        metaHtml += `<div class="mc"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div class="ml">${m.l}</div>`;
        if (m.l === 'Conversation ID' && m.v) {
            metaHtml += `<button class="btn-c" onclick="c2c('${escH(m.v).replace(/'/g,"\\'")}')" title="Copy">📋 Copy</button>`;
        }
        metaHtml += '</div>';
        if (m.b) {
            metaHtml += `<span class="badge badge-${m.v}">${m.v}</span>`;
        } else if (m.ck && CONFIG && CONFIG.clickable_patterns && CONFIG.clickable_patterns[m.ck] && CONFIG.clickable_patterns[m.ck].url_template && m.v) {
            const url = CONFIG.clickable_patterns[m.ck].url_template.replace('{value}', m.v);
            metaHtml += `<a href="${url}" target="_blank" style="color:#60dcfa;text-decoration:underline;font-size:13px;font-family:monospace;word-break:break-all">${escH(m.v)}</a>`;
        } else {
            metaHtml += `<div class="mv">${escH(m.v)}</div>`;
        }
        metaHtml += '</div>';
    }

    // Success / Fail
    let resultHtml = '';
    if (e.successLine) {
        resultHtml += `<div class="se"><div class="st" style="color:#34d399">✓ Success Match</div><div class="sb2" id="succBox"></div></div>`;
    }
    if (e.failLines && e.failLines.length > 0) {
        resultHtml += `<div class="se"><div class="st" style="color:#f87171">✗ Failure Matches</div><div class="fb" id="failBox"></div></div>`;
    }

    // Pattern Groups
    let groupsHtml = '';
    if (e.patternGroups && Object.keys(e.patternGroups).length > 0) {
        groupsHtml = '<div class="se"><div class="st" style="color:#60dcfa">Pattern Groups</div>';
        let gIdx = 0;
        for (const [, g] of Object.entries(e.patternGroups)) {
            groupsHtml += `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center"><div class="gn">${escH(g.name)}</div><button class="btn-c" onclick="c2c(document.getElementById('grp${gIdx}').innerText)">📋 Copy</button></div><div class="lb" id="grp${gIdx}" style="max-height:300px"></div></div>`;
            gIdx++;
        }
        groupsHtml += '</div>';
    }

    // Screenshots — read as base64 and embed
    let screenshotHtml = '';
    if (window.electronAPI && currentFilePath) {
        try {
            const screenshots = await window.electronAPI.getScreenshots({
                logFilePath: currentFilePath,
                utterance: e.utterance
            });
            if (screenshots && screenshots.length > 0) {
                screenshotHtml = '<div class="se"><div class="st" style="color:#a78bfa">📸 Screenshots</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:8px">';
                for (const ss of screenshots) {
                    try {
                        const base64 = await window.electronAPI.readScreenshot(ss.path);
                        if (base64) {
                            screenshotHtml += `<div style="border:1px solid #1e2433;border-radius:6px;overflow:hidden;background:#0a0d14;cursor:pointer" onclick="this.querySelector('img').requestFullscreen?this.querySelector('img').requestFullscreen():null" title="${escH(ss.name)}"><img src="data:image/png;base64,${base64}" style="width:100%;display:block"></div>`;
                        }
                    } catch (err) { /* skip */ }
                }
                screenshotHtml += '</div></div>';
            }
        } catch (err) { /* skip */ }
    }

    // All logs data + pattern data as JSON for safe embedding
    const allPatterns = getAllPatterns(CONFIG);
    const filteredLogs = e.allLines.map((line, index) => ({
        line,
        lineNumber: (e.lineNumbers && e.lineNumbers[index]) ? e.lineNumbers[index] : (index + 1)
    })).filter(item => allPatterns.some(re => re.test(item.line)));

    const allLogsData = filteredLogs.map(item => ({ ln: item.lineNumber, text: item.line }));
    const successLineData = e.successLine || '';
    const failLinesData = (e.failLines || []);
    const patternGroupsData = [];
    if (e.patternGroups) {
        for (const [, g] of Object.entries(e.patternGroups)) {
            patternGroupsData.push(g.lines);
        }
    }

    const ver = APP_VERSION ? `[${APP_VERSION}]` : '';

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Utterance Detail #${utteranceIndex} - ${escH(e.utterance)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080a10;color:#e2e8f0;font-family:'Segoe UI',system-ui,sans-serif;padding:0}
.hdr{background:#0b0e15;border-bottom:1px solid #1e2433;padding:16px 28px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:10}
.title{font-size:18px;font-weight:700}.sub{font-size:12px;color:#64748b;margin-top:2px}
.content{padding:24px 28px;max-width:1200px;margin:0 auto}
.mg{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:24px}
.mc{background:#0f1117;border-radius:8px;padding:12px 16px;border:1px solid #1e2433}
.ml{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:4px}
.mv{font-size:13px;color:#e2e8f0;font-family:monospace;word-break:break-all}
.badge{display:inline-block;padding:3px 12px;border-radius:4px;font-size:12px;font-weight:700;font-family:monospace;letter-spacing:.5px}
.badge-SUCCESS{background:#0d3b24;color:#34d399;border:1px solid #166534}
.badge-FAIL{background:#3b0d0d;color:#f87171;border:1px solid #7f1d1d}
.badge-PARTIAL{background:#3b2e0d;color:#fbbf24;border:1px solid #78350f}
.badge-Unknown{background:#1e1e2e;color:#94a3b8;border:1px solid #334155}
.se{margin-bottom:20px}.st{font-size:12px;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px}
.sb2{background:#0d3b24;border:1px solid #166534;border-radius:6px;padding:10px 14px;font-family:monospace;font-size:12px;color:#e2e8f0;white-space:pre-wrap;word-break:break-all}
.fb{background:#3b0d0d;border:1px solid #7f1d1d;border-radius:6px;padding:10px 14px;font-family:monospace;font-size:12px;color:#e2e8f0;white-space:pre-wrap;word-break:break-all}
.gn{font-size:11px;color:#a78bfa;font-weight:600;background:#1e1640;display:inline-block;padding:2px 10px;border-radius:4px}
.lb{background:#0a0d14;border:1px solid #1e2433;border-radius:6px;padding:10px 14px;overflow-y:auto;font-family:monospace;font-size:12px;line-height:20px;white-space:pre-wrap;word-break:break-all;color:#94a3b8}
.log-all{background:#0a0d14;border:1px solid #1e2433;border-radius:6px;padding:10px 14px;max-height:600px;overflow-y:auto;font-family:monospace;font-size:12px;line-height:20px;white-space:pre-wrap;word-break:break-all;color:#94a3b8}
.btn-c{background:#1e2433;border:1px solid #334155;color:#94a3b8;padding:3px 10px;border-radius:6px;cursor:pointer;font-size:11px;transition:all .2s}
.btn-c:hover{background:#2a3040;color:#e2e8f0;border-color:#4a5568}
.toast{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#34d399;color:#064e3b;padding:12px 24px;border-radius:10px;font-weight:600;z-index:9999;animation:fadeIn .3s}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:#0f1117}::-webkit-scrollbar-thumb{background:#2a3040;border-radius:3px}
</style></head>
<body>
<div class="hdr">
  <div><div class="title">Utterance Detail #${utteranceIndex}</div><div class="sub">${escH(e.utterance)} ${ver}</div></div>
  <div style="display:flex;gap:8px">
    <button class="btn-c" onclick="c2c(document.getElementById('allLogs').innerText)">📋 Copy All Logs</button>
  </div>
</div>
<div class="content">
  <div class="mg">${metaHtml}</div>
  ${resultHtml}
  ${groupsHtml}
  ${screenshotHtml}
  <div class="se">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div class="st" style="color:#94a3b8;margin:0">All Valid Logs (${allLogsData.length} lines)</div>
      <button class="btn-c" onclick="c2c(document.getElementById('allLogs').innerText)">📋 Copy All</button>
    </div>
    <div class="log-all" id="allLogs"></div>
  </div>
</div>
<script>
function esc(s){return s?s.toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):'N/A'}
${clickableScript}
function c2c(t){navigator.clipboard.writeText(t).then(()=>{const d=document.createElement('div');d.className='toast';d.textContent='Copied!';document.body.appendChild(d);setTimeout(()=>d.remove(),1500)}).catch(()=>{const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta)})}
const succLine=${JSON.stringify(successLineData)};
const failLines=${JSON.stringify(failLinesData)};
const pgData=${JSON.stringify(patternGroupsData)};
const logsData=${JSON.stringify(allLogsData)};
if(succLine){const el=document.getElementById('succBox');if(el)el.innerHTML=mkC(succLine)}
if(failLines.length){const el=document.getElementById('failBox');if(el)el.innerHTML=failLines.map(l=>mkC(l)).join('<br>')}
pgData.forEach((lines,i)=>{const el=document.getElementById('grp'+i);if(el)el.innerHTML=lines.map(l=>mkC(l)).join('<br>')});
document.getElementById('allLogs').innerHTML=logsData.map(d=>'<span style="color:#4a5568">L'+d.ln+'</span>  '+mkC(d.text)).join('\\n');
</script></body></html>`;
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
    h += `<div class="modal-hdr" style="border-bottom:1px solid #1e2433"><div style="flex:1"><div style="font-size:18px;font-weight:700">Utterance Detail #${utteranceIndex}</div><div style="font-size:13px;color:#64748b;margin-top:2px">${esc(e.utterance)}</div></div><div style="display:flex;gap:8px;align-items:center"><button class="btn btn-ghost" style="padding:4px 8px;font-size:11px" onclick="if(window.electronAPI)window.electronAPI.toggleDevTools()">🛠 DevTools</button></div></div>`;
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
            const groupText = sanitizeCtrl(g.lines.join('\n'));
            h += `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center"><div class="grp-name">${esc(g.name)}</div><button class="btn btn-ghost" style="padding:4px 8px;font-size:10px" onclick="copyToClipboard('${groupText.replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}')" title="Copy">📋 Copy</button></div><div class="log-box" style="max-height:200px">${g.lines.map(l => makeClickable(stripTs(l))).join('<br>')}</div></div>`;
        }
        h += '</div>';
    }

    if (window.electronAPI && currentFilePath) {
        const screenshots = await window.electronAPI.getScreenshots({ 
            logFilePath: currentFilePath, 
            utterance: e.utterance 
        });
        logToFile('info', `Fetched ${screenshots ? screenshots.length : 0} screenshots for utterance: "${e.utterance}"`);
        if (screenshots && screenshots.length > 0) {
            h += '<div class="section"><div class="sec-title" style="color:#a78bfa">📸 Screenshots</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-top:8px">';
            screenshots.forEach((ss, idx) => {
                const ssId = `ss_${idx}_${Date.now()}`;
                const escapedPath = ss.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                h += `<div style="cursor:pointer;border:1px solid #1e2433;border-radius:6px;overflow:hidden;aspect-ratio:1;background:#0a0d14;display:flex;align-items:center;justify-content:center;transition:all 0.2s" onclick="showScreenshotViewer('${escapedPath}')" title="${esc(ss.name)}" onmouseover="this.style.borderColor='#a78bfa'" onmouseout="this.style.borderColor='#1e2433'">
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

    const allPatterns = getAllPatterns(CONFIG);
    const filteredLogs = e.allLines.map((line, index) => ({
        line,
        lineNumber: (e.lineNumbers && e.lineNumbers[index]) ? e.lineNumbers[index] : (index + 1)
    })).filter(item => allPatterns.some(re => re.test(item.line)));

    const allLogsText = sanitizeCtrl(filteredLogs.map(item => `L${item.lineNumber}  ${item.line}`).join('\r\n'));

    h += `<div class="section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div class="sec-title" style="color:#94a3b8;margin:0">All Valid Logs (${filteredLogs.length} lines)</div><div style="display:flex;gap:8px"><button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="copyToClipboard('${allLogsText.replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}')">📋 Copy All</button><button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="if(window.electronAPI)window.electronAPI.openInBrowser('${allLogsText.replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}')">🌐 Open in Browser</button></div></div></div></div></div>`;

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

    let h = `<div class="modal-hdr"><div><div style="font-size:18px;font-weight:700">Utterance Detail</div><div style="font-size:13px;color:#64748b;margin-top:2px">${esc(e.utterance)}</div></div><div style="display:flex;gap:8px;align-items:center"><button class="btn btn-ghost" style="padding:4px 8px;font-size:11px" onclick="if(window.electronAPI)window.electronAPI.toggleDevTools()">🛠 DevTools</button><button class="modal-close" onclick="closeModal()" style="position:static;margin-left:10px">✕</button></div></div>`;
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
            const groupText = sanitizeCtrl(g.lines.join('\n'));
            h += `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center"><div class="grp-name">${esc(g.name)}</div><button class="btn btn-ghost" style="padding:4px 8px;font-size:10px" onclick="copyToClipboard('${groupText.replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}')" title="Copy">📋 Copy</button></div><div class="log-box" style="max-height:200px">${g.lines.map(l => makeClickable(stripTs(l))).join('<br>')}</div></div>`;
        }
        h += '</div>';
    }

    if (window.electronAPI && currentFilePath) {
        const screenshots = await window.electronAPI.getScreenshots({ 
            logFilePath: currentFilePath, 
            utterance: e.utterance 
        });
        logToFile('info', `Fetched ${screenshots ? screenshots.length : 0} screenshots for utterance: "${e.utterance}"`);
        if (screenshots && screenshots.length > 0) {
            h += '<div class="section"><div class="sec-title" style="color:#a78bfa">📸 Screenshots</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-top:8px">';
            screenshots.forEach((ss, idx) => {
                const ssId = `ss_${idx}_${Date.now()}`;
                const escapedPath = ss.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                h += `<div style="cursor:pointer;border:1px solid #1e2433;border-radius:6px;overflow:hidden;aspect-ratio:1;background:#0a0d14;display:flex;align-items:center;justify-content:center;transition:all 0.2s" onclick="showScreenshotViewer('${escapedPath}')" title="${esc(ss.name)}" onmouseover="this.style.borderColor='#a78bfa'" onmouseout="this.style.borderColor='#1e2433'">
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

    const allPatterns = getAllPatterns(CONFIG);
    const filteredLogs = e.allLines.map((line, index) => ({
        line,
        lineNumber: (e.lineNumbers && e.lineNumbers[index]) ? e.lineNumbers[index] : (index + 1)
    })).filter(item => allPatterns.some(re => re.test(item.line)));

    const allLogsText = sanitizeCtrl(filteredLogs.map(item => `L${item.lineNumber}  ${item.line}`).join('\r\n'));

    h += `<div class="section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div class="sec-title" style="color:#94a3b8;margin:0">All Valid Logs (${filteredLogs.length} lines)</div><div style="display:flex;gap:8px"><button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="copyToClipboard('${allLogsText.replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}')">📋 Copy All</button><button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="if(window.electronAPI)window.electronAPI.openInBrowser('${allLogsText.replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}')">🌐 Open in Browser</button></div></div></div></div>`;

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

    // Collect screenshot data per utterance if available
    const exportEntries = [];
    for (const e of entries) {
        const entry = {
            conversationId: e.conversationId, requestId: e.requestId, utterance: e.utterance, result: e.result,
            successLine: e.successLine ? stripTs(e.successLine) : null, failLines: e.failLines.map(stripTs), 
            allLines: e.allLines.map(stripTs), lineNumbers: e.lineNumbers,
            patternGroups: Object.fromEntries(Object.entries(e.patternGroups).map(([k, v]) => [k, { name: v.name, lines: v.lines.map(stripTs) }])),
            screenshots: []
        };
        // Read screenshots as base64 for embedding in export
        if (window.electronAPI && window.electronAPI.getScreenshots && currentFilePath) {
            try {
                const shots = await window.electronAPI.getScreenshots({ logFilePath: currentFilePath, utterance: e.utterance });
                if (shots && shots.length > 0) {
                    for (const ss of shots) {
                        try {
                            const b64 = await window.electronAPI.readScreenshot(ss.path);
                            if (b64) entry.screenshots.push({ name: ss.name, data: b64 });
                        } catch (_) {}
                    }
                }
            } catch (_) {}
        }
        exportEntries.push(entry);
    }

    const jsonStr = JSON.stringify({ config: { table_columns: CONFIG.table_columns, clickable_patterns: CONFIG.clickable_patterns }, stats: st, entries: exportEntries });
    let baseName = (currentFileName || 'report').replace(/\.[^.]+$/, '');
    if (currentFileName === 'clipboard-paste') {
        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        baseName = `${timestamp}_Clipboard`;
    }

    const reportHtml = generateReportHtml(jsonStr);
    
    // Use Tauri API if available to avoid IPC size limits
    if (window.__TAURI__ && window.__TAURI__.dialog) {
        try {
            const { save } = window.__TAURI__.dialog;
            const { writeTextFile } = window.__TAURI__.fs;
            const filePath = await save({
                defaultPath: `${baseName}_report.html`,
                filters: [{ name: 'HTML', extensions: ['html'] }]
            });
            if (filePath) {
                await writeTextFile(filePath, reportHtml);
                showToast('Export saved successfully!');
            }
        } catch (err) {
            showErrorToast(`Export failed: ${err}`);
        }
    } else if (window.electronAPI) {
        await window.electronAPI.saveExport({ htmlData: reportHtml, baseName });
    } else {
        const hBlob = new Blob([reportHtml], { type: 'text/html' });
        const hA = document.createElement('a'); hA.href = URL.createObjectURL(hBlob); hA.download = `${baseName}_report.html`; hA.click();
    }
}

function generateReportHtml(jsonData) {
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
.lb{background:#0a0d14;border:1px solid #1e2433;border-radius:6px;padding:10px 14px;max-height:400px;overflow-y:auto;font-family:monospace;font-size:12px;line-height:20px;white-space:pre-wrap;word-break:break-all;color:#94a3b8}
.sb2{background:#0d3b24;border:1px solid #166534;border-radius:6px;padding:8px 12px;font-family:monospace;font-size:12px;color:#e2e8f0;white-space:pre-wrap;word-break:break-all}
.fb{background:#3b0d0d;border:1px solid #7f1d1d;border-radius:6px;padding:8px 12px;font-family:monospace;font-size:12px;color:#e2e8f0;white-space:pre-wrap;word-break:break-all}
.ss-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-top:8px}
.ss-grid img{width:100%;display:block;border-radius:4px;cursor:pointer;transition:transform .2s}
.ss-grid img:hover{transform:scale(1.05)}
.se{margin-bottom:20px}.st{font-size:12px;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px}
.fp{border:2px dashed #1e2433;border-radius:12px;padding:40px;text-align:center;cursor:pointer;margin-bottom:20px}.fp:hover{border-color:#60dcfa}
.ssv{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;cursor:pointer}
.ssv img{max-width:95%;max-height:95%;object-fit:contain}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:#0f1117}::-webkit-scrollbar-thumb{background:#2a3040;border-radius:3px}</style></head>
<body><div class="hdr"><div><div class="title">Voice Interaction Log Report</div><div class="sub" id="fs">${ver}</div></div><div class="stats" id="sb"></div></div>
<div class="fp" id="fp" onclick="document.getElementById('ji').click()"><p style="color:#94a3b8;font-size:14px;margin-bottom:8px">Click to load the report JSON data file</p>
<p style="color:#4a5568;font-size:12px">Select the _data.json exported with this HTML</p><input type="file" id="ji" accept=".json" style="display:none" onchange="loadJ(this.files[0])"></div>
<div id="al" style="display:none;text-align:center;padding:20px;color:#94a3b8;font-size:13px">Loading data file...</div>
<input class="si" id="si" placeholder="Search all columns..." oninput="rt()" style="display:none">
<div id="tw" class="tw" style="display:none"><table><thead id="th"></thead><tbody id="tb"></tbody></table></div>
<div id="md" class="mo" onclick="cm()"><div class="mb" onclick="event.stopPropagation()" id="mc2"></div></div>
<script>
    const EMBEDDED_DATA = ${jsonData};
</script>
<script>let D,C,S,sc2=null,sd2='asc',fD2;
function esc2(s){return s?s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):'N/A'}
function mkC(t){if(!C||!t)return esc2(t);let r=esc2(t);for(const[,c]of Object.entries(C.clickable_patterns)){try{const re=new RegExp(c.pattern,'g');r=r.replace(re,(m,v)=>c.url_template?'<a href="'+c.url_template.replace('{value}',v)+'" target="_blank" style="color:#60dcfa;text-decoration:underline">'+m+'</a>':'<span style="color:#a8e6cf;font-weight:600">'+m+'</span>')}catch(e){}}return r}
function loadJ(f){const r=new FileReader();r.onload=e=>{try{const d=JSON.parse(e.target.result);D=d.entries;C=d.config;S=d.stats;init2()}catch(x){alert('Invalid JSON: '+x.message)}};r.readAsText(f)}
function init2(){document.getElementById('fp').style.display='none';document.getElementById('al').style.display='none';document.getElementById('si').style.display='';document.getElementById('tw').style.display='';
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
if(e.screenshots&&e.screenshots.length){h+='<div class="se"><div class="st" style="color:#a78bfa">📸 Screenshots ('+e.screenshots.length+')</div><div class="ss-grid">';e.screenshots.forEach(s=>{h+='<div style="border:1px solid #1e2433;border-radius:6px;overflow:hidden;background:#0a0d14" title="'+esc2(s.name)+'"><img src="data:image/png;base64,'+s.data+'" onclick="ssV(this.src)"></div>'});h+='</div></div>'}
h+='<div class="se"><div class="st" style="color:#94a3b8">All Valid Logs ('+e.allLines.length+' lines)</div><div class="lb">'+e.allLines.map((l,i)=>{const ln=(e.lineNumbers&&e.lineNumbers[i])?e.lineNumbers[i]:(i+1);return '<span style="color:#334155;min-width:30px;display:inline-block;text-align:right;margin-right:10px;user-select:none">L'+ln+'</span>'+mkC(l)}).join('<br>')+'</div></div></div>';
document.getElementById('mc2').innerHTML=h;document.getElementById('md').classList.add('op')}
function ssV(src){const d=document.createElement('div');d.className='ssv';d.onclick=()=>d.remove();d.innerHTML='<img src="'+src+'">';document.body.appendChild(d)}
function cm(){document.getElementById('md').classList.remove('op')}
document.addEventListener('keydown',e=>{if(e.key==='Escape')cm()});
window.onload=()=>{if(typeof EMBEDDED_DATA!=='undefined'){D=EMBEDDED_DATA.entries;C=EMBEDDED_DATA.config;S=EMBEDDED_DATA.stats;init2()}else{const p=window.location.pathname;const n=p.substring(p.lastIndexOf('/')+1);if(n.endsWith('_report.html')){const j=n.replace(/_report\\.html$/i,'_data.json');document.getElementById('al').style.display='';fetch(j).then(r=>{if(!r.ok)throw new Error(r.status);return r.json()}).then(d=>{D=d.entries;C=d.config;S=d.stats;init2()}).catch(()=>{document.getElementById('al').style.display='none'})}}};
<\/script></body></html>`;
}

function resetApp() {
    entries = []; filteredData = []; sortCol = null; sortDir = 'asc'; currentFileName = null; currentFilePath = null; currentEncoding = null; currentRawText = null;
    document.getElementById('dropzone').style.display = ''; 
    document.getElementById('resultsArea').style.display = 'none'; 
    document.getElementById('exportBtn').style.display = 'none';
    document.getElementById('refreshBtn').style.display = 'none';
    document.getElementById('screenshotSection').style.display = 'none';
    
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