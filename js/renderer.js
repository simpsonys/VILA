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
let streamingMode = true; // streaming analysis mode (false = wait until complete, true = show results in real-time)
let currentConfigFileName = null; // currently active preset config filename
let isLiveStreaming = false;
let screenshotSavePath = null;
let tablePageSize = 50; // rows shown in main results table (50/100/150/Infinity=ALL)

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
        // Init default screenshot folder
        if (window.electronAPI.initScreenshotFolder) {
            try {
                screenshotSavePath = await window.electronAPI.initScreenshotFolder();
                if (document.getElementById('screenshotFolder')) {
                    document.getElementById('screenshotFolder').textContent = `Save path: ${screenshotSavePath}`;
                }
            } catch (err) {
                console.error('Failed to init screenshot folder:', err);
            }
        }

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
            document.getElementById('presetRadiosWrap').innerHTML = '<span style="color:red;font-size:11px">Error loading presets</span>';
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
        document.getElementById('presetRadiosWrap').innerHTML = '<span style="font-size:11px;color:#64748b">Not in Electron mode</span>';
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
    
    // Update SDB Device Input if config has a default value
    if (CONFIG && CONFIG.default_sdb_device) {
        const sdbDeviceInput = document.getElementById('sdbDeviceInput');
        if (sdbDeviceInput) {
            sdbDeviceInput.value = CONFIG.default_sdb_device;
        }
    }

    updateDefaultCommands(); // Set initial commands
    initColumnFilters();
    setupEventListeners();
}

// ...

function updateDefaultCommands() {
    const deviceId = document.getElementById('sdbDeviceInput').value || '';

    // Update Live Log Command
    const liveLogCommandInput = document.getElementById('liveLogCommand');
    if (CONFIG && CONFIG.default_live_log_command) {
        if (deviceId) {
            liveLogCommandInput.value = CONFIG.default_live_log_command.replace('{deviceId}', deviceId);
        } else {
            liveLogCommandInput.value = CONFIG.default_live_log_command.replace(/\s*-s\s+{deviceId}/g, '').replace('{deviceId}', '');
        }
    } else {
        liveLogCommandInput.value = deviceId ? `sdb -s ${deviceId} shell dlogutil -v VOICE_CLIENT` : `sdb shell dlogutil -v VOICE_CLIENT`;
    }

    // Update Screenshot Command
    const screenshotCommandTextarea = document.getElementById('screenshotCommand');
    if (deviceId) {
        screenshotCommandTextarea.value = `sdb -s ${deviceId} shell rm -rf /tmp/dump_screen.png\nsdb -s ${deviceId} shell enlightenment_info -dump_screen\nsdb -s ${deviceId} pull /tmp/dump_screen.png yymmdd_hhmmss.png`;
    } else {
        screenshotCommandTextarea.value = `sdb shell rm -rf /tmp/dump_screen.png\nsdb shell enlightenment_info -dump_screen\nsdb pull /tmp/dump_screen.png yymmdd_hhmmss.png`;
    }
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

    const container = document.getElementById('presetRadiosWrap');
    container.innerHTML = '';

    if (!sortedPresets || sortedPresets.length === 0) {
        container.innerHTML = '<span style="font-size:11px;color:#64748b;padding:6px 14px">No presets found. Check config folder.</span>';
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

        const btn = document.createElement('button');
        btn.className = 'mode-btn';
        btn.dataset.preset = fileName;
        if (currentConfigFileName === fileName) {
            btn.classList.add('active');
        }
        btn.innerHTML = `<span class="mode-icon">🟢</span> ${displayName}`;
        btn.onclick = () => switchPreset(fileName);
        container.appendChild(btn);
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
            CONFIG = result.config;
            currentConfigFileName = result.fileName || fileName;
            updatePresetRadioSelection(currentConfigFileName);
            
            // Update SDB Device Input if preset has a default value
            if (CONFIG && CONFIG.default_sdb_device) {
                const sdbDeviceInput = document.getElementById('sdbDeviceInput');
                if (sdbDeviceInput) {
                    sdbDeviceInput.value = CONFIG.default_sdb_device;
                }
            }
            // Update the live log command input with new config and device
            updateDefaultCommands();
            
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
    const btns = document.querySelectorAll('#presetRadiosWrap .mode-btn');
    btns.forEach(btn => {
        if (btn.dataset.preset === fileName) {
            btn.classList.add('active');
            updatePresetLabel(fileName, btn.textContent.replace('🟢 ', '').trim());
        } else {
            btn.classList.remove('active');
        }
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

// Delete current custom preset
async function deleteCurrentPreset() {
    if (!currentConfigFileName) {
        showErrorToast('No preset selected.');
        return;
    }
    if (currentConfigFileName === 'pattern_config.json') {
        showErrorToast('Default preset cannot be deleted.');
        return;
    }
    if (!window.electronAPI || !window.electronAPI.deletePreset) {
        showErrorToast('Delete preset API not available.');
        return;
    }
    
    if (!confirm(`Are you sure you want to delete the preset '${currentConfigFileName}'?`)) {
        return;
    }

    try {
        const result = await window.electronAPI.deletePreset(currentConfigFileName);
        if (result && result.success) {
            showToast(`Preset deleted.`);
            await refreshPresetList();
            await switchPreset('pattern_config.json');
        } else {
            showErrorToast('Failed to delete preset.');
        }
    } catch (err) {
        console.error('Failed to delete preset:', err);
        showErrorToast('Failed to delete preset: ' + err.message);
    }
}

// Reset current preset to factory defaults
async function resetCurrentPreset() {
    if (!currentConfigFileName) {
        showErrorToast('No preset selected.');
        return;
    }
    
    if (!window.electronAPI || !window.electronAPI.resetPreset) {
        showErrorToast('Reset preset API not available.');
        return;
    }
    
    if (!confirm(`Are you sure you want to reset '${currentConfigFileName}' to its default factory settings? Any custom modifications to this file will be lost.`)) {
        return;
    }

    try {
        const result = await window.electronAPI.resetPreset(currentConfigFileName);
        if (result && result.success && result.config) {
            CONFIG = result.config;
            showToast(`Preset reset to default.`);
            // Refresh commands in case the default_live_log_command changed
            updateDefaultCommands();
            
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
        } else {
            showErrorToast(result.reason || 'Failed to reset preset.');
        }
    } catch (err) {
        console.error('Failed to reset preset:', err);
        showErrorToast('Failed to reset preset: ' + err.message);
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
        default_live_log_command: "sdb -s {deviceId} shell dlogutil -v VOICE_CLIENT",
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

    // Raw log scroll
    const rawLogViewer = document.getElementById('rawLogViewer');
    if (rawLogViewer) {
        rawLogViewer.addEventListener('scroll', () => {
            _isRawLogUserScrolled = rawLogViewer.scrollHeight - rawLogViewer.scrollTop > rawLogViewer.clientHeight + 50;
        });
    }

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
            if (result && !result.success) {
                if (result.reason === 'Canceled') {
                    // Restore UI to previous state
                    if (entries.length > 0) {
                        document.getElementById('dropzone').style.display = 'none';
                        document.getElementById('resultsArea').style.display = '';
                        document.getElementById('progressPanel').classList.add('show');
                        document.getElementById('progressLayout').style.display = 'none';
                        document.getElementById('progressSplitLayout').style.display = '';
                    } else {
                        document.getElementById('dropzone').style.display = '';
                        document.getElementById('resultsArea').style.display = 'none';
                        document.getElementById('progressPanel').classList.remove('show');
                    }
                } else {
                    showErrorToast(`Error during file open: ${result.reason}`, result.stack);
                }
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
    // Resolve file path: file.path (older Electron) or webUtils.getPathForFile (Electron 32+ with contextIsolation)
    let filePath = file.path;
    if (!filePath && window.electronAPI && window.electronAPI.getPathForFile) {
        try { filePath = window.electronAPI.getPathForFile(file); } catch (_) {}
    }
    logToFile('info', 'readFile called for file.', { name: file.name, path: filePath, size: file.size, type: file.type });
    if (window.electronAPI && window.electronAPI.openAndReadFile && filePath) {
        logToFile('info', 'File dropped, using streaming reader.', { path: filePath });
        window.electronAPI.openAndReadFile(filePath);
    } else {
        logToFile('warn', 'File dropped, but file path not resolvable. Falling back to FileReader.');
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

function stripLogPrefix(line, patterns) {
    if (!line) return line;
    if (patterns) {
        for (const p of patterns) {
            const idx = line.indexOf(p);
            if (idx >= 0) return line.substring(idx).trim();
        }
    }
    return stripTs(line);
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
        if (nc && nc.config) { CONFIG = nc.config; currentConfigFileName = nc.fileName; }
        else if (nc) CONFIG = nc;
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

let rawLogLines = []; // Store lines for raw log viewer search

function handleStreamingChunk(chunkData) {
    if (parseInterrupt) {
        if (window.electronAPI && window.electronAPI.cancelFileRead) {
            window.electronAPI.cancelFileRead();
        }
        return;
    }
    
    const text = typeof chunkData === 'string' ? chunkData : chunkData.text;
    const byteLength = typeof chunkData === 'string' ? 0 : chunkData.byteLength;

    // SDB literal \n normalization: convert backslash+n before timestamps to real newlines
    let normText = text;
    if (normText.includes('\\n')) {
        normText = normText.replace(/\\n(?=\[?\d{2}-\d{2}-\d{4}\s)/g, '\n');
        normText = normText.replace(/\\n(?=\d{4,6}\.\d{1,3}\s+[VDIWEF]\/)/g, '\n');
    }

    // If in live streaming mode, update the raw log viewer
    if (isLiveStreaming) {
        const linesToAdd = normText.split(/\r?\n/);
        rawLogLines.push(...linesToAdd);
        if (rawLogLines.length > 2000) {
            rawLogLines = rawLogLines.slice(rawLogLines.length - 2000);
        }
        renderRawLogViewer();
    }
    
    streamBytesProcessed += byteLength;

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
        conversationId: null, requestId: null, utterance: null,
        result: 'Unknown', successLine: null, failLines: [], allLines: lines, lineNumbers: lineNumbers, patternGroups: {}
    };

    // Initialize all custom clickable keys dynamically from table_columns if they exist
    if (CONFIG && CONFIG.table_columns) {
        CONFIG.table_columns.forEach(col => {
            if (col.key !== 'conversationId' && col.key !== 'requestId' && col.key !== 'utterance' && col.key !== 'result' && col.key !== 'successLine') {
                e[col.key] = null;
            }
        });
    }

    if (CONFIG && CONFIG.clickable_patterns) {
        e._allMatches = {};
        for (const [key, cfg] of Object.entries(CONFIG.clickable_patterns)) {
            try {
                const re = new RegExp(cfg.pattern);
                const collected = [];
                for (const l of lines) {
                    const m = l.match(re);
                    if (m && m[1]) collected.push(m[1].trim());
                }
                if (collected.length > 0) {
                    e[key] = collected[collected.length - 1]; // last match wins (e.g. capsuleGoal)
                    if (collected.length > 1) e._allMatches[key] = collected;
                }
            } catch (err) {
                console.error(`Invalid regex for clickable_pattern [${key}]:`, err);
            }
        }
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
        for (const sp of (CONFIG.success_patterns || [])) if (l.includes(sp)) { hasS = true; e.successLine = l; }
        if (CONFIG.failure_patterns) for (const fp of CONFIG.failure_patterns) if (l.includes(fp)) { hasF = true; e.failLines.push(l); }
    }

    if (CONFIG && CONFIG.enable_result_judgment === false) {
        e.result = 'N/A';
    } else {
        if (hasS && !hasF) e.result = 'SUCCESS';
        else if (hasS && hasF) e.result = 'PARTIAL';
        else if (!hasS && hasF) e.result = 'FAIL';
        else e.result = 'Unknown';
    }

    for (const [gK, gC] of Object.entries(CONFIG.pattern_groups || {})) {
        const ml = [];
        for (const l of lines) {
            for (const p of gC.patterns) {
                const ps = typeof p === 'string' ? p : (p && p.pattern) || '';
                try {
                    if (ps && new RegExp(ps).test(l)) {
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
    if (CONFIG && CONFIG.enable_result_judgment === false) {
        document.getElementById('statsBar').innerHTML = `<div class="stat"><span class="stat-val" style="color:#60dcfa">${entries.length}</span><span class="stat-label">Total Utterances</span></div>`;
        return { total: entries.length };
    }

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

function getUrlTemplate(cp, num) {
    if (num === 1) return cp.url_template1 || cp.url_template || null;
    if (num === 2) return cp.url_template2 || null;
    return null;
}

function makeClickable(text) {
    if (!CONFIG || !text) return esc(text);
    let r = esc(text);
    for (const [, c] of Object.entries(CONFIG.clickable_patterns)) {
        try {
            const re = new RegExp(c.pattern, 'g');
            const t1 = getUrlTemplate(c, 1);
            const t2 = getUrlTemplate(c, 2);
            r = r.replace(re, (m, v) => {
                if (!t1 && !t2) return `<span style="color:#a8e6cf;font-weight:600">${m}</span>`;
                let html = '<span style="display:inline-flex;flex-direction:column;gap:1px">';
                if (t1) html += `<a href="${t1.replace('{value}', v)}" target="_blank" class="click-link" onclick="event.stopPropagation()">${m}</a>`;
                if (t2) html += `<a href="${t2.replace('{value}', v)}" target="_blank" class="click-link" onclick="event.stopPropagation()" style="font-size:0.88em;color:#a8e6cf">${m}</a>`;
                html += '</span>';
                return html;
            });
        } catch { }
    }
    return r;
}

function extractLogDisplay(line, colKey) {
    if (!line) return null;
    // For successLine, show only from the matched success pattern onwards
    if (colKey === 'successLine' && CONFIG && CONFIG.success_patterns) {
        for (const sp of CONFIG.success_patterns) {
            const idx = line.indexOf(sp);
            if (idx >= 0) return line.substring(idx).trim();
        }
    }
    const arrowIdx = line.lastIndexOf('> ');
    const payload = arrowIdx >= 0 ? line.substring(arrowIdx + 2).trim() : line.trim();
    if (CONFIG.pattern_groups && CONFIG.pattern_groups[colKey]) {
        for (const p of CONFIG.pattern_groups[colKey].patterns) {
            const ps = typeof p === 'string' ? p : (p && p.pattern) || '';
            try {
                if (ps && new RegExp(ps).test(payload)) {
                    const litMatch = ps.match(/^([A-Za-z0-9_ ]+)/);
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

// ── TSV Export ──
function getTableAsTsv() {
    if (!filteredData || filteredData.length === 0) return '';
    const cols = CONFIG.table_columns;
    const header = cols.map(c => c.label).join('\t');
    const rows = filteredData.map(e =>
        cols.map(c => {
            let v = e[c.key];
            if (c.type === 'log' && v) v = extractLogDisplay(v, c.key);
            return (v || '').toString().replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
        }).join('\t')
    );
    return [header, ...rows].join('\r\n');
}

function copyTableAsTsv() {
    const tsv = getTableAsTsv();
    if (!tsv) { showToast('No data to copy.'); return; }
    copyToClipboard(tsv);
}

async function saveTableAsTsv() {
    const tsv = getTableAsTsv();
    if (!tsv) { showToast('No data to save.'); return; }
    const baseName = (currentFileName || 'report').replace(/\.[^.]+$/, '');
    const defaultName = `${baseName}_table.tsv`;
    if (window.electronAPI && window.electronAPI.saveTsv) {
        const result = await window.electronAPI.saveTsv({ tsvData: '\ufeff' + tsv, defaultName });
        if (result) showToast('TSV saved!');
    } else {
        const blob = new Blob(['\ufeff' + tsv], { type: 'text/tab-separated-values' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = defaultName;
        a.click();
    }
}

// ── Table Column Resizing ──
let isResizing = false;
let currentResizingColIdx = -1;
let startX = 0;
let startWidth = 0;

function initResizer(e, colIdx) {
    e.stopPropagation();
    isResizing = true;
    currentResizingColIdx = colIdx;
    startX = e.clientX;
    
    // Convert current width to pixels if it's a percentage
    const thElements = document.querySelectorAll('#tableHead .th');
    const th = thElements[colIdx];
    startWidth = th.getBoundingClientRect().width;
    
    // Set all column widths to pixels to ensure smooth resizing
    if (CONFIG && CONFIG.table_columns) {
        CONFIG.table_columns.forEach((col, idx) => {
            if (col.width.toString().includes('%')) {
                const el = thElements[idx];
                if (el) col.width = el.getBoundingClientRect().width + 'px';
            }
        });
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(e) {
    if (!isResizing) return;
    const diff = e.clientX - startX;
    let newWidth = startWidth + diff;
    if (newWidth < 50) newWidth = 50; // min width
    
    if (CONFIG && CONFIG.table_columns && CONFIG.table_columns[currentResizingColIdx]) {
        CONFIG.table_columns[currentResizingColIdx].width = newWidth + 'px';
        applyGridTemplateColumns();
    }
}

function onMouseUp() {
    isResizing = false;
    currentResizingColIdx = -1;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
}

function applyGridTemplateColumns() {
    if (!CONFIG || !CONFIG.table_columns) return;
    const gridCols = CONFIG.table_columns.map(c => c.width).join(' ');
    document.getElementById('tableHead').style.gridTemplateColumns = gridCols;
    const filtersEl = document.getElementById('tableFilters');
    if (filtersEl) filtersEl.style.gridTemplateColumns = gridCols;
    
    const rows = document.querySelectorAll('.table-body .tr');
    rows.forEach(row => {
        row.style.gridTemplateColumns = gridCols;
    });
}

function renderTable() {
    renderStats();
    const cols = CONFIG.table_columns;
    const gridCols = cols.map(c => c.width).join(' ');

    document.getElementById('tableHead').style.gridTemplateColumns = gridCols;
    document.getElementById('tableHead').innerHTML = cols.map((c, i) => {
        let icon = '<span style="opacity:0.25">⇅</span>';
        if (sortState[c.key] === 'asc') icon = '↑';
        else if (sortState[c.key] === 'desc') icon = '↓';
        return `<div class="th" onclick="cycleSort('${c.key}')" title="Sort by ${c.label}">${c.label}<span class="sort-icon">${icon}</span><div class="col-resizer" onmousedown="initResizer(event, ${i})"></div></div>`;
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
            if (filter === 'n/a') {
                if (e[col]) return false;
            } else if (filter.startsWith('!')) {
                const notTerm = filter.slice(1);
                if (notTerm && val.includes(notTerm)) return false;
            } else {
                if (!val.includes(filter)) return false;
            }
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
    } else if (isLiveStreaming) {
        // Default to showing the most recent test items at the top in Live mode
        rows = [...rows].reverse();
    }

    filteredData = rows;

    // Update count label
    const countLabel = document.getElementById('tableCountLabel');
    if (countLabel) {
        const totalFiltered = rows.length;
        const showing = tablePageSize === Infinity ? totalFiltered : Math.min(tablePageSize, totalFiltered);
        countLabel.textContent = `${showing} / ${entries.length} (filtered: ${totalFiltered})`;
    }

    // Apply page size slice for display
    const displayRows = tablePageSize === Infinity ? rows : rows.slice(0, tablePageSize);

    if (displayRows.length === 0) {
        document.getElementById('tableBody').innerHTML = `<div class="empty-msg">No entries found${q ? ` matching "${esc(q)}"` : ''}</div>`;
        return;
    }

    document.getElementById('tableBody').innerHTML = displayRows.map((e, i) => {
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
                if (cp && v) {
                    const t1 = getUrlTemplate(cp, 1);
                    const t2 = getUrlTemplate(cp, 2);
                    if (t1 || t2) {
                        let links = '<div style="display:flex;flex-direction:column;gap:2px;overflow:hidden;min-width:0">';
                        if (t1) links += `<a class="click-link" href="javascript:openURLExternal('${t1.replace('{value}', v)}')" onclick="event.stopPropagation()" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v)}</a>`;
                        if (t2) links += `<a class="click-link" href="javascript:openURLExternal('${t2.replace('{value}', v)}')" onclick="event.stopPropagation()" style="font-size:0.88em;color:#a8e6cf;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v)}</a>`;
                        links += '</div>';
                        return `<div class="td" style="white-space:normal;align-items:flex-start">${links}${copyBtn}</div>`;
                    }
                }
            }
            return `<div class="td"><span>${esc(v)}</span>${copyBtn}</div>`;
        }).join('');
        return `<div class="tr" style="grid-template-columns:${gridCols};animation-delay:${Math.min(i * 0.015, 0.4)}s" onclick="openDetailFromTable(${i})">${cells}</div>`;
    }).join('');
}

function renderTableBody() { renderTable(); }

function changeTablePageSize(val) {
    tablePageSize = val === 'all' ? Infinity : parseInt(val);
    renderTable();
}

function cycleSort(col) {
    if (sortState[col] === 'asc') sortState[col] = 'desc';
    else if (sortState[col] === 'desc') delete sortState[col];
    else sortState = { [col]: 'asc' };
    renderTable();
}

// ── Search & Render Raw Log Viewer ──
let rawLogSearchTerm = '';
function searchRawLog() {
    const box = document.getElementById('rawLogSearchBox');
    if (!box) return;
    rawLogSearchTerm = box.value.toLowerCase();
    renderRawLogViewer();
}

let _isRawLogUserScrolled = false;
function renderRawLogViewer() {
    const content = document.getElementById('rawLogContent');
    if (!content) return;
    
    let html = '';
    const term = rawLogSearchTerm;
    
    let utteranceRegexes = [];
    if (CONFIG && CONFIG.utterance_patterns) {
        for (const [, cfg] of Object.entries(CONFIG.utterance_patterns)) {
            try { utteranceRegexes.push(new RegExp(cfg.pattern)); } catch(e){}
        }
    }
    if (utteranceRegexes.length === 0 && CONFIG && CONFIG.start_patterns) {
        try { utteranceRegexes.push(new RegExp(CONFIG.start_patterns.join('|'))); } catch(e){}
    }

    for (let i = 0; i < rawLogLines.length; i++) {
        const line = rawLogLines[i];
        if (!line) continue;
        if (term && !line.toLowerCase().includes(term)) continue;
        
        // makeClickable handles escaping
        let displayLine = makeClickable(line);
        
        // Bold yellow highlight for utterance ONLY
        let utteranceStr = null;
        for (const re of utteranceRegexes) {
            const m = line.match(re);
            if (m) {
                if (m[1]) {
                    utteranceStr = m[1];
                } else {
                    // Fallback extraction for start_patterns without capture group
                    const commaIdx = line.indexOf(',');
                    if (commaIdx > -1) {
                        utteranceStr = line.substring(commaIdx + 1).trim();
                    } else {
                        const bMatch = line.match(/\[([^\]]+)\]/);
                        if (bMatch) utteranceStr = bMatch[1];
                    }
                }
                break;
            }
        }
        if (utteranceStr && utteranceStr.trim().length > 0) {
            const escapedUtt = esc(utteranceStr);
            // Replace the last occurrence to avoid matching log prefixes
            const replaceIdx = displayLine.lastIndexOf(escapedUtt);
            if (replaceIdx !== -1) {
                displayLine = displayLine.substring(0, replaceIdx) + 
                              `<span style="color:#fbbf24;font-weight:bold">${escapedUtt}</span>` + 
                              displayLine.substring(replaceIdx + escapedUtt.length);
            }
        }

        if (term) {
            // Very simple highlight: replace text outside of tags
            const regex = new RegExp(`(?![^<]+>)(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            displayLine = displayLine.replace(regex, '<mark style="background:#fbbf24;color:#000">$1</mark>');
        }
        
        html += displayLine + '\n';
    }
    
    content.innerHTML = html;
    
    // Auto-scroll logic
    const parent = content.parentElement;
    if (!_isRawLogUserScrolled) {
        parent.scrollTop = parent.scrollHeight;
    }
}

// ── Streaming Mode ──
function setStreamingMode(enabled) {
    streamingMode = enabled;
    localStorage.setItem('streamingMode', streamingMode);
    updateModeButtons();
}

// ── Preset Menu ──
let presetMenuVisible = false;
function togglePresetMenu() {
    presetMenuVisible = !presetMenuVisible;
    const presetMenu = document.getElementById('presetMenu');
    const presetBtn = document.getElementById('presetToggleBtn');
    if (presetMenuVisible) {
        presetMenu.style.display = 'flex';
        presetBtn.classList.add('active');
        presetBtn.style.color = '#60dcfa';
        presetBtn.style.borderColor = '#2a4a7c';
        presetBtn.style.background = 'linear-gradient(135deg, #1a3a5c, #1e2d5c)';
    } else {
        presetMenu.style.display = 'none';
        presetBtn.classList.remove('active');
        presetBtn.style.color = '';
        presetBtn.style.borderColor = '';
        presetBtn.style.background = '';
    }
}

// Update preset label
function updatePresetLabel(fileName, displayName) {
    const label = document.getElementById('currentPresetLabel');
    if (label) {
        label.textContent = displayName || fileName.replace(/Preset\d+_(.+)_pattern_config\.json/, '$1').replace(/_/g, ' ').replace('pattern_config.json', 'Default');
    }
}

// ── DEV Menu ──
let devMenuVisible = false;
function toggleDevMenu() {
    devMenuVisible = !devMenuVisible;
    const devMenu = document.getElementById('devMenu');
    const devBtn = document.getElementById('devToggleBtn');
    if (devMenuVisible) {
        devMenu.style.display = 'flex';
        devBtn.classList.add('active');
        devBtn.style.color = '#60dcfa';
        devBtn.style.borderColor = '#2a4a7c';
        devBtn.style.background = 'linear-gradient(135deg, #1a3a5c, #1e2d5c)';
    } else {
        devMenu.style.display = 'none';
        devBtn.classList.remove('active');
        devBtn.style.color = '';
        devBtn.style.borderColor = '';
        devBtn.style.background = '';
    }
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
        document.getElementById('dropzone').style.display = 'none';
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

function clearLiveLog() {
    // Reset raw log viewer
    rawLogLines = [];
    document.getElementById('rawLogContent').textContent = '';

    // Reset parsed entries and table
    entries = [];
    renderTable();

    // Reset streaming state so next start_pattern begins fresh
    streamBlockBuffer = [];
    streamBlockLineNumbers = [];
    streamInBlock = false;
    streamFoundCount = 0;
    streamMatchedCount = 0;

    // Reset progress counters
    const el1 = document.getElementById('progFound');
    const el2 = document.getElementById('progMatched');
    if (el1) el1.textContent = '0';
    if (el2) el2.textContent = '0';
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
                g.patterns.forEach(p => patterns.add(typeof p === 'string' ? p : (p && p.pattern) || ''));
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

// ── Sequence Diagram ──
function generatePlantUMLForEntry(entry) {
    const lines = entry.allLines || [];
    const plantItems = [];

    function extractValue(line, match) {
        if (match && match[1]) return match[1].trim();
        if (match && match.index !== undefined) return line.substring(match.index).trim();
        return line.trim();
    }

    // Normalize PlantUML field: accepts string or array of strings
    function pumlTemplates(puml) {
        if (!puml) return [];
        return Array.isArray(puml) ? puml : [puml];
    }
    // Normalize pattern entry: accepts string or {pattern, PlantUML?} object
    function patStr(p) { return typeof p === 'string' ? p : (p && p.pattern) || ''; }
    // Apply template substitution + line number prefix at start of label (after last ': ')
    function applyPuml(tmpl, value, lineNum) {
        const isTitle = tmpl.trimStart().startsWith('title');
        if (isTitle || !tmpl.includes('{value}')) return tmpl.replace('{value}', value);
        const colonIdx = tmpl.lastIndexOf(': ');
        const labelTmpl = colonIdx >= 0 ? tmpl.substring(colonIdx + 2) : tmpl;
        const labelStr = `L${lineNum}: ${labelTmpl.replace('{value}', value)}`;
        return colonIdx >= 0 ? tmpl.substring(0, colonIdx + 2) + labelStr : labelStr;
    }

    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        const lineNum = (entry.lineNumbers && entry.lineNumbers[li]) ? entry.lineNumbers[li] : (li + 1);

        // utterance_patterns
        for (const [, cfg] of Object.entries(CONFIG.utterance_patterns || {})) {
            if (!cfg.PlantUML) continue;
            try {
                const m = line.match(new RegExp(cfg.pattern));
                if (m) {
                    const value = extractValue(line, m);
                    for (const tmpl of pumlTemplates(cfg.PlantUML)) {
                        const isTitle = tmpl.trimStart().startsWith('title');
                        plantItems.push({ text: applyPuml(tmpl, value, lineNum), isTitle });
                    }
                }
            } catch {}
        }

        // clickable_patterns
        for (const [, cfg] of Object.entries(CONFIG.clickable_patterns || {})) {
            if (!cfg.PlantUML) continue;
            try {
                const m = line.match(new RegExp(cfg.pattern));
                if (m) {
                    const value = extractValue(line, m);
                    for (const tmpl of pumlTemplates(cfg.PlantUML)) {
                        plantItems.push({ text: applyPuml(tmpl, value, lineNum), isTitle: false });
                    }
                }
            } catch {}
        }

        // pattern_groups — patterns can be strings or {pattern, PlantUML?} objects
        for (const [, grpCfg] of Object.entries(CONFIG.pattern_groups || {})) {
            for (const pEntry of (grpCfg.patterns || [])) {
                const ps = patStr(pEntry);
                if (!ps) continue;
                const entryPuml = (typeof pEntry === 'object' && pEntry.PlantUML) ? pEntry.PlantUML : grpCfg.PlantUML;
                if (!entryPuml) continue;
                try {
                    const m = line.match(new RegExp(ps));
                    if (m) {
                        const value = extractValue(line, m);
                        for (const tmpl of pumlTemplates(entryPuml)) {
                            plantItems.push({ text: applyPuml(tmpl, value, lineNum), isTitle: false });
                        }
                        break; // one match per group per line
                    }
                } catch {}
            }
        }
    }

    const titles = plantItems.filter(p => p.isTitle).map(p => p.text);
    const nonTitles = plantItems.filter(p => !p.isTitle).map(p => p.text);

    return ['@startuml', ...titles, ...nonTitles, '@enduml'].join('\n');
}

async function openDetailFromTable(idx) {
    const e = filteredData[idx];
    if (!e) return;
    const utteranceIndex = entries.indexOf(e) + 1 || idx + 1;

    // Fallback to modal if not in Electron
    if (!window.electronAPI || !window.electronAPI.openDetailHtml) {
        showDetail(idx); return;
    }

    try {
        const html = await generateDetailHtml(e, utteranceIndex);
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
        { l: 'Capsule Goal', v: e.capsuleGoal, allV: e._allMatches && e._allMatches.capsuleGoal },
        { l: 'Utterance', v: e.utterance }
    ];
    if (CONFIG && CONFIG.enable_result_judgment !== false) {
        metas.push({ l: 'Result', v: e.result, b: true });
    }
    
    for (const m of metas) {
        metaHtml += `<div class="mc"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div class="ml">${m.l}</div>`;
        if (m.l === 'Conversation ID' && m.v) {
            metaHtml += `<button class="btn-c" onclick="c2c('${escH(m.v).replace(/'/g,"\\'")}')" title="Copy">📋 Copy</button>`;
        }
        metaHtml += '</div>';
        if (m.b) {
            metaHtml += `<span class="badge badge-${m.v}">${m.v}</span>`;
        } else if (m.ck && CONFIG && CONFIG.clickable_patterns && CONFIG.clickable_patterns[m.ck]) {
            const cp = CONFIG.clickable_patterns[m.ck];
            const t1 = getUrlTemplate(cp, 1); const t2 = getUrlTemplate(cp, 2);
            if ((t1 || t2) && m.v) {
                let lnk = '';
                if (t1) lnk += `<a href="${t1.replace('{value}', m.v)}" target="_blank" style="color:#60dcfa;text-decoration:underline;font-size:13px;font-family:monospace;word-break:break-all">${escH(m.v)}</a>`;
                if (t2) lnk += `<br><a href="${t2.replace('{value}', m.v)}" target="_blank" style="color:#a8e6cf;text-decoration:underline;font-size:12px;font-family:monospace;word-break:break-all">${escH(m.v)}</a>`;
                metaHtml += `<div class="mv">${lnk}</div>`;
            } else metaHtml += `<div class="mv">${escH(m.v)}</div>`;
        } else if (m.allV && m.allV.length > 1) {
            // Multiple values (e.g. capsuleGoal changed during utterance) - show all, last is final
            metaHtml += `<div class="mv">${m.allV.map((v, i) => `<span style="${i === m.allV.length - 1 ? 'color:#e2e8f0;font-weight:600' : 'color:#64748b;text-decoration:line-through'}">${escH(v)}</span>`).join('<span style="color:#334155;margin:0 4px">→</span>')}</div>`;
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
                utterance: e.utterance,
                utteranceIndex: utteranceIndex
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

    // ── Sequence Diagram (local SVG renderer, no external requests) ──
    const pumlText = generatePlantUMLForEntry(e);
    const seqScript = `const seqPuml=${JSON.stringify(pumlText)};
let seqOpen=false;
function toggleSeq(){
  seqOpen=!seqOpen;
  const sec=document.getElementById('seqSection');
  const btn=document.getElementById('seqBtn');
  if(seqOpen){
    sec.style.display='block';
    btn.style.color='#a78bfa';btn.style.borderColor='rgba(167,139,250,0.5)';btn.style.background='linear-gradient(135deg,#1e1640,#1e1e40)';
    updateSeq();
    setTimeout(()=>sec.scrollIntoView({behavior:'smooth',block:'start'}),50);
  }else{sec.style.display='none';btn.style.color='';btn.style.borderColor='';btn.style.background=''}
}
function scheduleSeq(){clearTimeout(window._st);window._st=setTimeout(updateSeq,600)}
function updateSeq(){const txt=document.getElementById('seqPumlTxt').value;document.getElementById('seqSvgWrap').innerHTML=renderSeqSVG(txt)}
function copySeqPuml(){const t=document.getElementById('seqPumlTxt').value;navigator.clipboard.writeText(t).then(()=>{const b=document.getElementById('seqCopyBtn');const o=b.textContent;b.textContent='\\u2713 Copied!';setTimeout(()=>b.textContent=o,1500)}).catch(()=>{const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta)})}
function renderSeqSVG(src){
  const lines=src.split('\\n').map(l=>l.trim()).filter(l=>l&&l!=='@startuml'&&l!=='@enduml');
  let title='',pOrd=[],pSet=new Set(),msgs=[];
  for(const l of lines){
    if(l.startsWith('title ')){title=l.slice(6).trim();continue}
    // Note lines: "note right: text", "note left: text", "note over P: text", "note over P,Q: text"
    const nm=l.match(/^note\\s+(right|left|over)\\s*([^:]*)\\s*:\\s*(.*)$/i);
    if(nm){
      const nPos=nm[1].toLowerCase();
      const nParts=nm[2].trim()?nm[2].split(',').map(p=>p.trim()).filter(Boolean):[];
      msgs.push({type:'note',pos:nPos,parts:nParts,lb:nm[3].trim(),dashed:false});
      continue;
    }
    let f,t,lb,dashed=false;
    // Right arrows: A->B, A->>B, A-->B, A-->>B, A->oB, A->xB
    const rm=l.match(/^(\\S+)\\s*(-+>>?[ox]?|[ox]?-+>>?[ox]?)\\s+([^:\\s]+)\\s*:\\s*(.*)$/);
    if(rm){f=rm[1].trim();t=rm[3].trim();lb=rm[4].trim();dashed=rm[2].includes('--')}
    else{
      // Left arrows: A<-B, A<<-B, A<--B, A<<--B (swap direction)
      const lm=l.match(/^(\\S+)\\s*(<<?-+[<]?)\\s+([^:\\s]+)\\s*:\\s*(.*)$/);
      if(lm){f=lm[3].trim();t=lm[1].trim();lb=lm[4].trim();dashed=lm[2].includes('--')}
      else{
        // Old custom format: A -{label}-> B
        const om=l.match(/^(\\S+)\\s*-(.*)->\\s*(\\S+)$/);
        if(om){f=om[1].trim();lb=om[2].trim();t=om[3].trim()}
      }
    }
    if(f&&t){if(!pSet.has(f)){pSet.add(f);pOrd.push(f)}if(!pSet.has(t)){pSet.add(t);pOrd.push(t)}msgs.push({f,t,lb:lb||'',dashed})}
  }
  if(!pOrd.length)return '<div style="color:#64748b;font-size:12px;padding:16px;text-align:center">No sequence arrows found in PlantUML source.</div>';
  const ev=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const PAD=40,PW=150,PH=34,BASE_MH=54,FONT=11,NOTE_MAX=80,LH=13,FK=8;
  const wL=(lb,max)=>{if(!lb||lb.length<=max)return[lb||''];const r=[];let s=lb;while(s.length>max){r.push(s.slice(0,max));s=s.slice(max);}r.push(s);return r};
  // Arrow labels: no wrapping (show full text). Notes: wrap at NOTE_MAX chars.
  const mLines=msgs.map(m=>m.type==='note'?wL(m.lb,NOTE_MAX):[m.lb||'']);
  const rH=mLines.map(ls=>BASE_MH+(ls.length-1)*LH);
  const totMH=rH.reduce((a,b)=>a+b,0);
  // GAP based on arrow labels only (notes don't affect participant spacing)
  const arrowLns=msgs.flatMap((m,i)=>m.type==='note'?[]:mLines[i]);
  const maxChunk=Math.max(10,...(arrowLns.length?arrowLns.map(l=>l.length):[10]));
  const GAP=Math.max(220,Math.round(maxChunk*6.5)+60);
  const N=pOrd.length;
  const cx={};pOrd.forEach((p,i)=>{cx[p]=PAD+PW/2+i*GAP});
  // Pre-compute note box dimensions and positions
  msgs.forEach((msg,i)=>{
    if(msg.type!=='note')return;
    const wls=mLines[i];
    const maxNL=Math.max(10,...wls.map(l=>l.length));
    const NW=Math.max(400,Math.round(maxNL*7)+20);
    const NH=12+wls.length*LH+12;
    let nx=0,nw=NW;
    if(msg.pos==='right'){
      nx=Math.max(...pOrd.map(p=>cx[p]))+PW/2+10;
    }else if(msg.pos==='left'){
      nx=Math.min(...pOrd.map(p=>cx[p]))-PW/2-NW-10;
    }else{ // 'over'
      if(msg.parts.length>=2){
        const x1=cx[msg.parts[0]]!=null?cx[msg.parts[0]]:cx[pOrd[0]];
        const x2=cx[msg.parts[1]]!=null?cx[msg.parts[1]]:cx[pOrd[N-1]];
        nx=Math.min(x1,x2)-PW/2;
        nw=Math.max(NW,Math.abs(x2-x1)+PW);
      }else{
        const px=msg.parts[0]&&cx[msg.parts[0]]!=null?cx[msg.parts[0]]:cx[pOrd[Math.floor((N-1)/2)]];
        nx=px-NW/2;
      }
    }
    msg._nx=nx;msg._nw=nw;msg._nh=NH;
  });
  // Shift diagram right if any note overflows left
  let xShift=0;
  msgs.forEach(msg=>{if(msg.type==='note'&&msg._nx<PAD)xShift=Math.max(xShift,PAD-msg._nx)});
  if(xShift>0){pOrd.forEach(p=>{cx[p]+=xShift});msgs.forEach(msg=>{if(msg.type==='note')msg._nx+=xShift})}
  // Expand SVG width if any note overflows right
  const baseW=PAD*2+(N-1)*GAP+PW+xShift;
  let extraW=0;
  msgs.forEach(msg=>{if(msg.type==='note')extraW=Math.max(extraW,msg._nx+msg._nw-(baseW-PAD))});
  const W=baseW+Math.max(0,extraW);
  const tH=title?40:0,H=tH+PAD/2+PH+totMH+PH+PAD/2;
  let s='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" style="display:block;min-width:'+W+'px">';
  s+='<rect width="'+W+'" height="'+H+'" fill="#0a0d14"/>';
  if(title)s+='<text x="'+(W/2)+'" y="28" text-anchor="middle" font-size="14" font-weight="700" fill="#e2e8f0" font-family="Segoe UI,system-ui,sans-serif">'+ev(title)+'</text>';
  const topY=tH+PAD/2;
  pOrd.forEach(p=>{const x=cx[p]-PW/2;s+='<rect x="'+x+'" y="'+topY+'" width="'+PW+'" height="'+PH+'" rx="5" fill="#0f1219" stroke="#2a3a5c" stroke-width="1.5"/><text x="'+cx[p]+'" y="'+(topY+PH/2+5)+'" text-anchor="middle" font-size="'+(FONT+1)+'" font-weight="600" fill="#60dcfa" font-family="Consolas,monospace">'+ev(p)+'</text>'});
  const llY1=topY+PH,llY2=llY1+totMH;
  pOrd.forEach(p=>{s+='<line x1="'+cx[p]+'" y1="'+llY1+'" x2="'+cx[p]+'" y2="'+llY2+'" stroke="#1e2433" stroke-width="1.5" stroke-dasharray="6,4"/>'});
  let cumY=llY1;
  msgs.forEach((msg,i)=>{
    const rh=rH[i],wls=mLines[i],tl=wls.length;
    const yArr=cumY+rh*0.5;cumY+=rh;
    if(msg.type==='note'){
      // Draw note box with folded corner
      const nx=msg._nx,NW=msg._nw,NH=msg._nh,ny=yArr-NH/2;
      const txMid=nx+NW/2,ty0=ny+14;
      s+='<polygon points="'+nx+','+ny+' '+(nx+NW-FK)+','+ny+' '+(nx+NW)+','+(ny+FK)+' '+(nx+NW)+','+(ny+NH)+' '+nx+','+(ny+NH)+'" fill="#1a2010" stroke="#fbbf24" stroke-width="1.5"/>';
      s+='<polygon points="'+(nx+NW-FK)+','+ny+' '+(nx+NW)+','+(ny+FK)+' '+(nx+NW-FK)+','+(ny+FK)+'" fill="#4a3800" stroke="#fbbf24" stroke-width="1"/>';
      s+='<text text-anchor="middle" font-size="'+FONT+'" fill="#fbbf24" font-family="Consolas,monospace">';
      wls.forEach((ln,li)=>{s+='<tspan x="'+txMid+'" y="'+(ty0+li*LH)+'">'+ev(ln)+'</tspan>'});
      s+='</text>';
    }else{
      const x1=cx[msg.f]!=null?cx[msg.f]:PAD+PW/2,x2=cx[msg.t]!=null?cx[msg.t]:PAD+PW/2;
      const clr=msg.dashed?'#7dd3a8':'#60dcfa';
      const da=msg.dashed?' stroke-dasharray="6,4"':'';
      if(msg.f===msg.t){
        const rx=x1+58;
        s+='<path d="M'+x1+','+(yArr-14)+' C'+rx+','+(yArr-14)+' '+rx+','+(yArr+14)+' '+x1+','+(yArr+14)+'" fill="none" stroke="#a78bfa" stroke-width="1.5"'+da+'/>';
        s+='<polygon points="'+x1+','+(yArr+14)+' '+(x1-6)+','+(yArr+6)+' '+(x1+6)+','+(yArr+6)+'" fill="#a78bfa"/>';
        const ty0=yArr-(tl-1)*LH/2;
        s+='<text font-size="'+FONT+'" fill="#a78bfa" font-family="Consolas,monospace">';
        wls.forEach((ln,li)=>{s+='<tspan x="'+(rx+6)+'" y="'+(ty0+li*LH)+'">'+ev(ln)+'</tspan>'});
        s+='</text>';
      }else{
        const d=x2>x1?1:-1;
        s+='<line x1="'+x1+'" y1="'+yArr+'" x2="'+x2+'" y2="'+yArr+'" stroke="'+clr+'" stroke-width="1.5"'+da+'/>';
        s+='<polygon points="'+x2+','+yArr+' '+(x2-d*10)+','+(yArr-5)+' '+(x2-d*10)+','+(yArr+5)+'" fill="'+clr+'"/>';
        const midX=(x1+x2)/2,ty0=yArr-tl*LH;
        s+='<text text-anchor="middle" font-size="'+FONT+'" fill="#e2e8f0" font-family="Consolas,monospace">';
        wls.forEach((ln,li)=>{s+='<tspan x="'+midX+'" y="'+(ty0+li*LH)+'">'+ev(ln)+'</tspan>'});
        s+='</text>';
      }
    }
  });
  pOrd.forEach(p=>{const x=cx[p]-PW/2;s+='<rect x="'+x+'" y="'+llY2+'" width="'+PW+'" height="'+PH+'" rx="5" fill="#0f1219" stroke="#2a3a5c" stroke-width="1.5"/><text x="'+cx[p]+'" y="'+(llY2+PH/2+5)+'" text-anchor="middle" font-size="'+(FONT+1)+'" font-weight="600" fill="#60dcfa" font-family="Consolas,monospace">'+ev(p)+'</text>'});
  s+='</svg>';return s;
}`;

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Utterance Detail #${utteranceIndex} - ${escH(e.utterance)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080a10;color:#e2e8f0;font-family:'Segoe UI',system-ui,sans-serif;padding:0}
.hdr{background:#0b0e15;border-bottom:1px solid #1e2433;padding:16px 28px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:10}
.title{font-size:18px;font-weight:700}.sub{font-size:12px;color:#64748b;margin-top:2px}
.content{padding:24px 28px}
.mg{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:24px}
.mc{background:#0f1117;border-radius:8px;padding:12px 16px;border:1px solid #1e2433}
.ml{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:4px}
.mv{font-size:13px;color:#e2e8f0;font-family:monospace;word-break:break-all}
.badge{display:inline-block;padding:3px 12px;border-radius:4px;font-size:12px;font-weight:700;font-family:monospace;letter-spacing:.5px}
.badge-SUCCESS{background:#0d3b24;color:#34d399;border:1px solid #166534}
.badge-FAIL{background:#3b0d0d;color:#f87171;border:1px solid #7f1d1d}
.badge-PARTIAL{background:#3b2e0d;color:#fbbf24;border:1px solid #78350f}
.badge-Unknown,.badge-N\\/A{background:#1e1e2e;color:#94a3b8;border:1px solid #334155}
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
    <button class="btn-c" id="seqBtn" onclick="toggleSeq()" style="border-color:rgba(167,139,250,0.3)">&#128202; Sequence</button>
    <button class="btn-c" onclick="c2c(document.getElementById('allLogs').innerText)">&#128203; Copy All Logs</button>
  </div>
</div>
<div class="content">
  <div class="mg">${metaHtml}</div>
  ${resultHtml}
  ${groupsHtml}
  ${screenshotHtml}
  <div id="seqSection" style="display:none;margin-top:4px">
    <div class="se" style="margin-bottom:0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div class="st" style="color:#a78bfa;margin:0">&#128202; Sequence Diagram</div>
        <button class="btn-c" id="seqCopyBtn" onclick="copySeqPuml()">&#128203; Copy PlantUML</button>
      </div>
      <textarea id="seqPumlTxt" spellcheck="false" oninput="scheduleSeq()" style="width:100%;height:160px;background:#0a0d14;color:#a8c4e0;font-family:'Consolas',monospace;font-size:11px;line-height:1.6;border:1px solid #1e2433;border-radius:6px;padding:10px 14px;outline:none;resize:vertical;box-sizing:border-box">${escH(pumlText)}</textarea>
      <div id="seqSvgWrap" style="margin-top:12px;overflow-x:auto;background:#0a0d14;border:1px solid #1e2433;border-radius:6px;padding:16px"></div>
    </div>
  </div>
  <div class="se">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div class="st" style="color:#94a3b8;margin:0">All Valid Logs (${allLogsData.length} lines)</div>
      <button class="btn-c" onclick="c2c(document.getElementById('allLogs').innerText)">&#128203; Copy All</button>
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
${seqScript}
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

    const metaCards = [
        { l: 'Conversation ID', v: e.conversationId, ck: 'conversationId' }, 
        { l: 'Request ID', v: e.requestId, ck: 'requestId' }, 
        { l: 'Capsule Goal', v: e.capsuleGoal, allV: e._allMatches && e._allMatches.capsuleGoal }, 
        { l: 'Utterance', v: e.utterance }
    ];
    if (CONFIG && CONFIG.enable_result_judgment !== false) {
        metaCards.push({ l: 'Result', v: e.result, b: 1 });
    }

    metaCards.forEach(m => {
        h += `<div class="meta-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div class="meta-label">${m.l}</div>`;
        if (m.l === 'Conversation ID' && m.v) {
            h += `<button class="btn btn-ghost" style="padding:2px 6px;font-size:10px" onclick="copyToClipboard('${m.v.replace(/'/g, "\\'")}')" title="Copy ID">📋 Copy</button>`;
        }
        h += '</div>';
        if (m.b) h += `<span class="badge badge-${m.v}">${m.v}</span>`;
        else if (m.ck && CONFIG && CONFIG.clickable_patterns && CONFIG.clickable_patterns[m.ck] && m.v) {
            const cp = CONFIG.clickable_patterns[m.ck];
            const t1 = getUrlTemplate(cp, 1); const t2 = getUrlTemplate(cp, 2);
            let lnk = '';
            if (t1) lnk += `<a href="javascript:void(0)" onclick="openURLExternal('${t1.replace('{value}', m.v)}');event.stopPropagation();return false" class="click-link" style="font-size:13px;font-family:Consolas,monospace;word-break:break-all">${esc(m.v)}</a>`;
            else lnk = `<div class="meta-val">${esc(m.v)}</div>`;
            if (t2) lnk += `<br><a href="javascript:void(0)" onclick="openURLExternal('${t2.replace('{value}', m.v)}');event.stopPropagation();return false" class="click-link" style="font-size:12px;color:#a8e6cf;font-family:Consolas,monospace;word-break:break-all">${esc(m.v)}</a>`;
            h += lnk;
        } else if (m.allV && m.allV.length > 1) {
            h += `<div class="meta-val">${m.allV.map((v, i) => `<span style="${i === m.allV.length - 1 ? 'color:#e2e8f0;font-weight:600' : 'color:#64748b;text-decoration:line-through'}">${esc(v)}</span>`).join('<span style="color:#334155;margin:0 4px">→</span>')}</div>`;
        } else h += `<div class="meta-val">${esc(m.v)}</div>`;
        h += '</div>';
    });
    h += '</div>';

    if (e.successLine) h += `<div class="section"><div class="sec-title" style="color:#34d399">✓ Success Match</div><div class="succ-box">${makeClickable(stripLogPrefix(e.successLine, CONFIG && CONFIG.success_patterns))}</div></div>`;
    if (e.failLines.length > 0) h += `<div class="section"><div class="sec-title" style="color:#f87171">✗ Failure Matches</div><div class="fail-box">${e.failLines.map(l => makeClickable(stripLogPrefix(l, CONFIG && CONFIG.failure_patterns))).join('<br>')}</div></div>`;

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
            utterance: e.utterance,
            utteranceIndex: utteranceIndex
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
    const utteranceIndex = entries.indexOf(e) + 1 || idx + 1;

    let h = `<div class="modal-hdr"><div><div style="font-size:18px;font-weight:700">Utterance Detail</div><div style="font-size:13px;color:#64748b;margin-top:2px">${esc(e.utterance)}</div></div><div style="display:flex;gap:8px;align-items:center"><button class="btn btn-ghost" style="padding:4px 8px;font-size:11px" onclick="if(window.electronAPI)window.electronAPI.toggleDevTools()">🛠 DevTools</button><button class="modal-close" onclick="closeModal()" style="position:static;margin-left:10px">✕</button></div></div>`;
    h += '<div class="modal-content"><div class="meta-grid">';

    const metaCards = [
        { l: 'Conversation ID', v: e.conversationId, ck: 'conversationId' }, 
        { l: 'Request ID', v: e.requestId, ck: 'requestId' }, 
        { l: 'Capsule Goal', v: e.capsuleGoal, allV: e._allMatches && e._allMatches.capsuleGoal }, 
        { l: 'Utterance', v: e.utterance }
    ];
    if (CONFIG && CONFIG.enable_result_judgment !== false) {
        metaCards.push({ l: 'Result', v: e.result, b: 1 });
    }

    metaCards.forEach(m => {
        h += `<div class="meta-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div class="meta-label">${m.l}</div>`;
        if (m.l === 'Conversation ID' && m.v) {
            h += `<button class="btn btn-ghost" style="padding:2px 6px;font-size:10px" onclick="copyToClipboard('${m.v.replace(/'/g, "\\'")}')" title="Copy ID">📋 Copy</button>`;
        }
        h += '</div>';
        if (m.b) h += `<span class="badge badge-${m.v}">${m.v}</span>`;
        else if (m.ck && CONFIG && CONFIG.clickable_patterns && CONFIG.clickable_patterns[m.ck] && m.v) {
            const cp = CONFIG.clickable_patterns[m.ck];
            const t1 = getUrlTemplate(cp, 1); const t2 = getUrlTemplate(cp, 2);
            let lnk = '';
            if (t1) lnk += `<a href="javascript:void(0)" onclick="openURLExternal('${t1.replace('{value}', m.v)}');event.stopPropagation();return false" class="click-link" style="font-size:13px;font-family:Consolas,monospace;word-break:break-all">${esc(m.v)}</a>`;
            else lnk = `<div class="meta-val">${esc(m.v)}</div>`;
            if (t2) lnk += `<br><a href="javascript:void(0)" onclick="openURLExternal('${t2.replace('{value}', m.v)}');event.stopPropagation();return false" class="click-link" style="font-size:12px;color:#a8e6cf;font-family:Consolas,monospace;word-break:break-all">${esc(m.v)}</a>`;
            h += lnk;
        } else if (m.allV && m.allV.length > 1) {
            h += `<div class="meta-val">${m.allV.map((v, i) => `<span style="${i === m.allV.length - 1 ? 'color:#e2e8f0;font-weight:600' : 'color:#64748b;text-decoration:line-through'}">${esc(v)}</span>`).join('<span style="color:#334155;margin:0 4px">→</span>')}</div>`;
        } else h += `<div class="meta-val">${esc(m.v)}</div>`;
        h += '</div>';
    });
    h += '</div>';

    if (e.successLine) h += `<div class="section"><div class="sec-title" style="color:#34d399">✓ Success Match</div><div class="succ-box">${makeClickable(stripLogPrefix(e.successLine, CONFIG && CONFIG.success_patterns))}</div></div>`;
    if (e.failLines.length > 0) h += `<div class="section"><div class="sec-title" style="color:#f87171">✗ Failure Matches</div><div class="fail-box">${e.failLines.map(l => makeClickable(stripLogPrefix(l, CONFIG && CONFIG.failure_patterns))).join('<br>')}</div></div>`;

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
            utterance: e.utterance,
            utteranceIndex: utteranceIndex
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
let currentScreenshotPath = null;
async function showScreenshotViewer(filePath) {
    if (!window.electronAPI) return;
    const base64 = await window.electronAPI.readScreenshot(filePath);
    if (!base64) { showErrorToast('Failed to load screenshot'); return; }
    currentScreenshotPath = filePath;
    screenshotViewerScale = 1;
    document.getElementById('screenshotImage').src = `data:image/png;base64,${base64}`;
    document.getElementById('screenshotImage').style.transform = 'scale(1)';
    document.getElementById('zoomLevel').textContent = '100%';
    document.getElementById('screenshotViewer').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeScreenshotViewer() { 
    currentScreenshotPath = null;
    document.getElementById('screenshotViewer').classList.remove('open');
    document.body.style.overflow = '';
}

function changeScreenshotZoom(delta) { screenshotViewerScale = Math.min(Math.max(0.2, screenshotViewerScale + delta), 3); updateScreenshotZoom(); }

function resetScreenshotZoom() { screenshotViewerScale = 1; updateScreenshotZoom(); }

function updateScreenshotZoom() {
    const img = document.getElementById('screenshotImage');
    img.style.transform = `scale(${screenshotViewerScale})`;
    document.getElementById('zoomLevel').textContent = Math.round(screenshotViewerScale * 100) + '%';
}

function screenshotWheel(e) { if (e.ctrlKey) { e.preventDefault(); changeScreenshotZoom(e.deltaY < 0 ? 0.1 : -0.1); } }

async function copyScreenshotToClipboard(e) {
    e.stopPropagation();
    if (!currentScreenshotPath || !window.electronAPI) return;
    const success = await window.electronAPI.copyScreenshotToClipboard(currentScreenshotPath);
    if (success) showToast("Image copied to clipboard!");
    else showErrorToast("Failed to copy image to clipboard");
}

async function saveScreenshotAs(e) {
    e.stopPropagation();
    if (!currentScreenshotPath || !window.electronAPI) return;
    const newPath = await window.electronAPI.saveScreenshotAs(currentScreenshotPath);
    if (newPath) showToast(`Image saved as ${newPath}`);
}

async function revealScreenshotInExplorer(e) {
    e.stopPropagation();
    if (!currentScreenshotPath || !window.electronAPI) return;
    await window.electronAPI.revealScreenshotInExplorer(currentScreenshotPath);
}

// ── Export Logic ──
async function doExport() {
    const st = { total: entries.length, success: entries.filter(e => e.result === 'SUCCESS').length, fail: entries.filter(e => e.result === 'FAIL').length, partial: entries.filter(e => e.result === 'PARTIAL').length, unknown: entries.filter(e => e.result === 'Unknown').length };
    st.passRate = (st.success + st.fail) > 0 ? ((st.success / (st.success + st.fail)) * 100).toFixed(1) : '-';

    const exportEntries = [];
    for (let ei = 0; ei < entries.length; ei++) {
        const e = entries[ei];
        const entry = {
            conversationId: e.conversationId, requestId: e.requestId, capsuleGoal: e.capsuleGoal, utterance: e.utterance, result: e.result,
            successLine: e.successLine ? stripLogPrefix(e.successLine, CONFIG && CONFIG.success_patterns) : null,
            failLines: e.failLines.map(l => stripLogPrefix(l, CONFIG && CONFIG.failure_patterns)),
            allLines: e.allLines.map(stripTs), lineNumbers: e.lineNumbers,
            patternGroups: Object.fromEntries(Object.entries(e.patternGroups).map(([k, v]) => [k, { name: v.name, lines: v.lines.map(stripTs) }])),
            _allMatches: e._allMatches || {},
            screenshots: []
        };
        if (window.electronAPI && window.electronAPI.getScreenshots && currentFilePath) {
            try {
                const shots = await window.electronAPI.getScreenshots({ logFilePath: currentFilePath, utterance: e.utterance, utteranceIndex: ei + 1 });
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
        // Copy any custom column keys from config
        if (CONFIG && CONFIG.table_columns) {
            CONFIG.table_columns.forEach(col => {
                if (!(col.key in entry)) entry[col.key] = e[col.key] || null;
            });
        }
        exportEntries.push(entry);
    }

    const CHUNK_SIZE = 50;
    const configData = { table_columns: CONFIG.table_columns, clickable_patterns: CONFIG.clickable_patterns };
    const totalEntries = exportEntries.length;
    const totalChunks = Math.max(1, Math.ceil(totalEntries / CHUNK_SIZE));

    const jsonChunks = [];
    for (let i = 0; i < totalChunks; i++) {
        const chunk = {
            chunkIndex: i, totalChunks, totalEntries,
            config: configData, stats: st,
            entries: exportEntries.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
        };
        jsonChunks.push(JSON.stringify(chunk));
    }

    const _now = new Date();
    const _ts = () => `${String(_now.getFullYear()).slice(2)}${String(_now.getMonth()+1).padStart(2,'0')}${String(_now.getDate()).padStart(2,'0')}_${String(_now.getHours()).padStart(2,'0')}${String(_now.getMinutes()).padStart(2,'0')}${String(_now.getSeconds()).padStart(2,'0')}`;
    let baseName = (currentFileName || '').replace(/\.[^.]+$/, '');
    if (!baseName || isLiveStreaming) {
        baseName = `LiveLog_${_ts()}`;
    } else if (currentFileName === 'clipboard-paste') {
        baseName = `${_ts()}_Clipboard`;
    }

    const reportHtml = generateReportHtml();
    if (window.electronAPI) {
        await window.electronAPI.saveExport({ htmlData: reportHtml, jsonChunks, baseName });
    } else {
        // Browser fallback: download HTML + first chunk only
        const hBlob = new Blob([reportHtml], { type: 'text/html' });
        const hA = document.createElement('a'); hA.href = URL.createObjectURL(hBlob); hA.download = `${baseName}_report.html`; hA.click();
        const jBlob = new Blob([jsonChunks[0]], { type: 'application/json' });
        const jA = document.createElement('a'); jA.href = URL.createObjectURL(jBlob); jA.download = `${baseName}_data_001.json`; jA.click();
    }
}

function generateReportHtml() {
    const ver = APP_VERSION ? `[${APP_VERSION}] by SimpsonYS` : '';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Voice Interaction Log Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080a10;color:#e2e8f0;font-family:'Segoe UI',system-ui,sans-serif;padding:20px}
.hdr{border-bottom:1px solid #1e2433;padding:16px 0 12px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px}
.title{font-size:18px;font-weight:700}.sub{font-size:12px;color:#4a5568;margin-top:2px}
.stats{display:flex;gap:8px;flex-wrap:wrap}
.stat{background:#0f1117;border:1px solid #1e2433;border-radius:8px;padding:6px 14px;display:flex;align-items:center;gap:8px}
.stat b{font-size:18px;font-weight:700;font-family:monospace}.stat span{font-size:11px;color:#64748b}
.ctrl-row{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.si{background:#0f1117;border:1px solid #1e2433;border-radius:8px;padding:8px 14px;color:#e2e8f0;font-size:13px;flex:1;min-width:200px;outline:none}
.si:focus{border-color:#2a4a7c}
.pss{background:#0f1117;border:1px solid #1e2433;border-radius:8px;padding:7px 10px;color:#e2e8f0;font-size:12px;outline:none;cursor:pointer}
.cntlbl{font-size:11px;color:#4a5568;white-space:nowrap}
.tw{background:#0b0e15;border:1px solid #1e2433;border-radius:12px;overflow:hidden}
table{width:100%;border-collapse:collapse;font-size:12px}
th.sh{background:#0f1219;border-bottom:1px solid #1e2433;padding:9px 10px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.8px;cursor:pointer;user-select:none;white-space:nowrap;position:relative}
th.sh:hover{background:#141c2a;color:#94a3b8}
.cr{position:absolute;right:0;top:0;height:100%;width:5px;cursor:col-resize;background:transparent}
.cr:hover{background:rgba(96,220,250,0.3)}
.btn-cd{background:#1e2433;border:1px solid #334155;color:#94a3b8;padding:3px 10px;border-radius:6px;cursor:pointer;font-size:11px}
.btn-cd:hover{background:#2a3040;color:#e2e8f0}
th.fh{background:#0a0d14;border-bottom:1px solid #1e2433;padding:4px 6px}
.fi{background:#0f1117;border:1px solid #1e2433;border-radius:6px;padding:5px 8px;color:#e2e8f0;font-size:11px;width:100%;outline:none}
.fi:focus{border-color:#2a4a7c}
td{padding:9px 10px;border-bottom:1px solid #141822;font-family:monospace;color:#94a3b8;max-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
td.wrap{white-space:normal;word-break:break-all}
tr.dr:hover{background:#111625}
.badge{display:inline-block;padding:2px 10px;border-radius:4px;font-size:11px;font-weight:700;font-family:monospace;letter-spacing:.5px}
.badge-SUCCESS{background:#0d3b24;color:#34d399;border:1px solid #166534}
.badge-FAIL{background:#3b0d0d;color:#f87171;border:1px solid #7f1d1d}
.badge-PARTIAL{background:#3b2e0d;color:#fbbf24;border:1px solid #78350f}
.badge-Unknown,.badge-N\\/A{background:#1e1e2e;color:#94a3b8;border:1px solid #334155}
.utt{color:#60dcfa;text-decoration:underline;cursor:pointer}
.cl{color:#60dcfa;text-decoration:underline;cursor:pointer}
.cl:hover{color:#a8e6cf}
.mo{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.75);display:none;justify-content:center;padding:40px 20px;overflow-y:auto}
.mo.op{display:flex}
.mb{background:#0f1117;border:1px solid #1e2433;border-radius:12px;width:100%;max-width:1100px;height:fit-content}
.mh{padding:20px 28px;border-bottom:1px solid #1e2433;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#0f1117;z-index:1}
.cb{background:#1e2433;border:none;color:#94a3b8;font-size:18px;cursor:pointer;border-radius:8px;width:36px;height:36px}
.mg{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:24px}
.mc{background:#161b26;border-radius:8px;padding:12px 16px;border:1px solid #1e2433}
.ml{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:4px}
.mv{font-size:13px;color:#e2e8f0;font-family:monospace;word-break:break-all}
.gn{font-size:11px;color:#a78bfa;font-weight:600;background:#1e1640;display:inline-block;padding:2px 10px;border-radius:4px;margin-bottom:4px}
.lb{background:#0a0d14;border:1px solid #1e2433;border-radius:6px;padding:10px 14px;max-height:400px;overflow-y:auto;font-family:monospace;font-size:12px;line-height:20px;white-space:pre-wrap;word-break:break-all;color:#94a3b8}
.sb2{background:#0d3b24;border:1px solid #166534;border-radius:6px;padding:8px 12px;font-family:monospace;font-size:12px;color:#e2e8f0;white-space:pre-wrap;word-break:break-all}
.fb2{background:#3b0d0d;border:1px solid #7f1d1d;border-radius:6px;padding:8px 12px;font-family:monospace;font-size:12px;color:#e2e8f0;white-space:pre-wrap;word-break:break-all}
.se{margin-bottom:20px}.st{font-size:12px;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px}
.fp{border:2px dashed #1e2433;border-radius:12px;padding:40px;text-align:center;cursor:pointer;margin-bottom:16px}
.fp:hover{border-color:#60dcfa}
.ss-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-top:8px}
.ss-grid img{width:100%;display:block;border-radius:4px;cursor:pointer;transition:transform .2s}
.ss-grid img:hover{transform:scale(1.05)}
.ssv{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;cursor:pointer}
.ssv img{max-width:95%;max-height:95%;object-fit:contain}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:#0f1117}::-webkit-scrollbar-thumb{background:#2a3040;border-radius:3px}
</style></head>
<body>
<div class="hdr">
  <div><div class="title">Voice Interaction Log Report</div><div class="sub" id="fs">${ver}</div></div>
  <div class="stats" id="sb"></div>
</div>
<div id="al" style="text-align:center;padding:40px;color:#94a3b8;font-size:13px">
  <div style="margin-bottom:12px;font-size:18px">⏳</div>Loading report data...
</div>
<div id="fp" class="fp" style="display:none" onclick="document.getElementById('ji').click()">
  <p style="color:#94a3b8;font-size:14px;margin-bottom:8px">⚠️ Auto-load failed. Click to manually select the JSON data file.</p>
  <p style="color:#4a5568;font-size:12px">Select the <b>_data_001.json</b> file exported with this HTML</p>
  <input type="file" id="ji" accept=".json" style="display:none" onchange="loadManual(this.files[0])">
</div>
<div id="mainui" style="display:none">
  <div class="ctrl-row">
    <input class="si" id="si" placeholder="Search all columns..." oninput="rt()">
    <span style="color:#64748b;font-size:12px;white-space:nowrap">Show:</span>
    <select class="pss" id="pss" onchange="changePageSize(this.value)">
      <option value="50" selected>50</option>
      <option value="100">100</option>
      <option value="150">150</option>
      <option value="all">ALL</option>
    </select>
    <span class="cntlbl" id="cntlbl"></span>
  </div>
  <div class="tw">
    <table>
      <thead id="th"></thead>
      <thead id="tf"></thead>
      <tbody id="tb"></tbody>
    </table>
  </div>
</div>
<div id="md" class="mo" onclick="cm()"><div class="mb" onclick="event.stopPropagation()" id="mc2"></div></div>
<script>
var D=[],C=null,S=null,totalChunks=0,totalEntries=0,loadedChunks=0;
var sc2=null,sd2='asc',fD2=[],pageSize=50,cFil={};
function esc2(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):'N/A'}
function gt1(cp){return cp.url_template1||cp.url_template||null}
function gt2(cp){return cp.url_template2||null}
function mkC(t){if(!C||!t)return esc2(t);var r=esc2(t);for(var k in C.clickable_patterns){var c=C.clickable_patterns[k];try{var re=new RegExp(c.pattern,'g');var t1=gt1(c),t2=gt2(c);r=r.replace(re,function(m,v){if(!t1&&!t2)return'<span style="color:#a8e6cf;font-weight:600">'+m+'</span>';var h='<span style="display:inline-flex;flex-direction:column;gap:1px">';if(t1)h+='<a href="'+t1.replace('{value}',v)+'" target="_blank" style="color:#60dcfa;text-decoration:underline">'+m+'</a>';if(t2)h+='<a href="'+t2.replace('{value}',v)+'" target="_blank" style="color:#a8e6cf;text-decoration:underline;font-size:0.88em">'+m+'</a>';h+='</span>';return h})}catch(e){}}return r}
function getBN(){var p=decodeURIComponent(window.location.pathname);var n=p.substring(p.lastIndexOf('/')+1);return n.replace(/_report\\.html$/i,'')}
async function loadChunk(idx){var n=String(idx+1).padStart(3,'0');var url=getBN()+'_data_'+n+'.json';var resp=await fetch(url);if(!resp.ok)throw new Error('HTTP '+resp.status);var data=await resp.json();if(idx===0){C=data.config;S=data.stats;totalChunks=data.totalChunks;totalEntries=data.totalEntries;if(C&&C.table_columns)C.table_columns.forEach(function(col){cFil[col.key]=''})}D=D.concat(data.entries);loadedChunks=idx+1}
async function changePageSize(val){pageSize=val==='all'?Infinity:parseInt(val);var need=pageSize===Infinity?totalChunks:Math.ceil(pageSize/50);for(var i=loadedChunks;i<need&&i<totalChunks;i++){try{await loadChunk(i)}catch(e){break}}rt()}
function init2(){document.getElementById('al').style.display='none';document.getElementById('fp').style.display='none';document.getElementById('mainui').style.display='';
document.getElementById('fs').textContent=totalEntries+' utterances';
document.getElementById('sb').innerHTML= (C && C.enable_result_judgment === false) ? '<div class="stat"><b style="color:#60dcfa">'+S.total+'</b><span>Total Utterances</span></div>' : [{l:'Total',v:S.total,c:'#60dcfa'},{l:'Success',v:S.success,c:'#34d399'},{l:'Fail',v:S.fail,c:'#f87171'},{l:'Partial',v:S.partial,c:'#fbbf24'},{l:'Unknown',v:S.unknown,c:'#94a3b8'},{l:'Pass Rate',v:S.passRate+'%',c:'#a78bfa'}].map(function(s){return'<div class="stat"><b style="color:'+s.c+'">'+s.v+'</b><span>'+s.l+'</span></div>'}).join('');
document.getElementById('th').innerHTML='<tr>'+C.table_columns.map(function(c){return'<th class="sh" onclick="ds2(\\''+c.key+'\\')\" id=\"sh_'+c.key+'">'+c.label+' <span id="si_'+c.key+'" style="opacity:0.35">⇅</span><div class="cr" onmousedown="initCR(event,this.parentElement)" onclick="event.stopPropagation()"></div></th>'}).join('')+'</tr>';
document.getElementById('tf').innerHTML='<tr>'+C.table_columns.map(function(c){return'<th class="fh"><input class="fi" placeholder="'+c.label+'..." data-col="'+c.key+'" oninput="cfCh(this)"></th>'}).join('')+'</tr>';
rt()}
function cfCh(inp){cFil[inp.dataset.col]=(inp.value||'').toLowerCase();rt()}
function ds2(c){if(sc2===c)sd2=sd2==='asc'?'desc':'asc';else{sc2=c;sd2='asc'};C.table_columns.forEach(function(col){var el=document.getElementById('si_'+col.key);if(el)el.textContent=col.key===sc2?(sd2==='asc'?'↑':'↓'):'⇅'});rt()}
function gf2(){var q=(document.getElementById('si').value||'').toLowerCase();var r=pageSize===Infinity?D:D.slice(0,pageSize);if(q)r=r.filter(function(e){return Object.values(e).some(function(v){return(v||'').toString().toLowerCase().includes(q)})});Object.keys(cFil).forEach(function(col){if(!cFil[col])return;var cf=cFil[col];r=r.filter(function(e){var val=(e[col]||'').toString().toLowerCase();if(cf==='n/a'){return !e[col]}if(cf.charAt(0)==='!'){var nt=cf.slice(1);return !nt||!val.includes(nt)}return val.includes(cf)})});if(sc2)r=[].concat(r).sort(function(a,b){var va=(a[sc2]||'').toString().toLowerCase(),vb=(b[sc2]||'').toString().toLowerCase();return sd2==='asc'?va.localeCompare(vb):vb.localeCompare(va)});fD2=r;return r}
function rt(){var rows=gf2(),cols=C.table_columns;var showing=pageSize===Infinity?totalEntries:Math.min(pageSize,totalEntries);document.getElementById('cntlbl').textContent='Showing '+showing+'/'+totalEntries+' | '+rows.length+' after filter';document.getElementById('tb').innerHTML=rows.map(function(e,i){return'<tr class="dr" style="cursor:pointer" onclick="sd3('+i+')">'+cols.map(function(c){var v=e[c.key];var sv=v||'N/A';if(c.type==='badge')return'<td><span class="badge badge-'+sv+'">'+sv+'</span></td>';if(c.type==='utterance')return'<td class="wrap"><span class="utt">'+esc2(sv)+'</span></td>';if(c.clickable_key&&C.clickable_patterns[c.clickable_key]&&v){var cp=C.clickable_patterns[c.clickable_key];var t1=gt1(cp),t2=gt2(cp);if(t1||t2){var lnk='<div style="display:flex;flex-direction:column;gap:2px">';if(t1)lnk+='<a class="cl" href="'+t1.replace('{value}',v)+'" target="_blank" onclick="event.stopPropagation()">'+esc2(v)+'</a>';if(t2)lnk+='<a class="cl" href="'+t2.replace('{value}',v)+'" target="_blank" onclick="event.stopPropagation()" style="color:#a8e6cf;font-size:0.88em">'+esc2(v)+'</a>';lnk+='</div>';return'<td class="wrap">'+lnk+'</td>'}}if(c.type==='log')return'<td class="wrap">'+mkC(sv)+'</td>';return'<td>'+esc2(sv)+'</td>'}).join('')+'</tr>'}).join('')}
var curE2=null;
function sd3(i){var e=fD2[i];if(!e)return;curE2=e;
var h='<div class="mh"><div><div style="font-size:18px;font-weight:700">Utterance Detail</div><div style="font-size:13px;color:#64748b;margin-top:2px">'+esc2(e.utterance)+'</div></div>';
h+='<div style="display:flex;gap:8px;align-items:center"><button class="btn-cd" id="seqBtnD" onclick="tgSeqD()">&#128202; Sequence</button><button class="btn-cd" onclick="cpAllLogsD()">&#128203; Copy All Logs</button><button class="cb" onclick="cm()">&#10005;</button></div></div>';
h+='<div style="padding:20px 28px">';
h+='<div class="mg">';
var metaArr=[{l:'Conversation ID',v:e.conversationId,ck:'conversationId'},{l:'Request ID',v:e.requestId,ck:'requestId'},{l:'Capsule Goal',v:e.capsuleGoal,allV:e._allMatches&&e._allMatches.capsuleGoal},{l:'Utterance',v:e.utterance}];
if(C&&C.enable_result_judgment!==false)metaArr.push({l:'Result',v:e.result,b:1});
metaArr.forEach(function(m){
  h+='<div class="mc"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div class="ml">'+m.l+'</div>';
  if(m.l==='Conversation ID'&&m.v)h+='<button class="btn-cd" data-convid="'+esc2(m.v)+'" onclick="cpConvD(this)" style="font-size:10px;padding:2px 7px">&#128203; Copy</button>';
  h+='</div>';
  if(m.b){h+='<span class="badge badge-'+m.v+'">'+m.v+'</span>'}
  else if(m.ck&&C.clickable_patterns&&C.clickable_patterns[m.ck]&&m.v){var cp=C.clickable_patterns[m.ck];var t1=gt1(cp),t2=gt2(cp);var lnk='';if(t1)lnk+='<a href="'+t1.replace('{value}',m.v)+'" target="_blank" style="color:#60dcfa;text-decoration:underline;font-size:13px;font-family:monospace;word-break:break-all">'+esc2(m.v)+'</a>';else lnk=esc2(m.v);if(t2)lnk+='<br><a href="'+t2.replace('{value}',m.v)+'" target="_blank" style="color:#a8e6cf;text-decoration:underline;font-size:12px;font-family:monospace;word-break:break-all">'+esc2(m.v)+'</a>';h+='<div class="mv">'+lnk+'</div>'}
  else if(m.allV&&m.allV.length>1){h+='<div class="mv">'+m.allV.map(function(v,idx){return'<span style="'+(idx===m.allV.length-1?'color:#e2e8f0;font-weight:600':'color:#64748b;text-decoration:line-through')+'">'+esc2(v)+'</span>'}).join('<span style="color:#334155;margin:0 4px">&#8594;</span>')+'</div>'}
  else{h+='<div class="mv">'+esc2(m.v)+'</div>'}
  h+='</div>';
});
h+='</div>';
if(e.successLine)h+='<div class="se"><div class="st" style="color:#34d399">&#10003; Success Match</div><div class="sb2">'+mkC(e.successLine)+'</div></div>';
if(e.failLines&&e.failLines.length)h+='<div class="se"><div class="st" style="color:#f87171">&#10007; Failure Matches</div><div class="fb2">'+e.failLines.map(function(l){return mkC(l)}).join('<br>')+'</div></div>';
if(e.patternGroups&&Object.keys(e.patternGroups).length){h+='<div class="se"><div class="st" style="color:#60dcfa">Pattern Groups</div>';for(var gk in e.patternGroups){var g=e.patternGroups[gk];h+='<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center"><div class="gn">'+esc2(g.name)+'</div><button class="btn-cd" onclick="cpTxt(this.parentElement.nextElementSibling.innerText)">&#128203; Copy</button></div><div class="lb" style="max-height:200px">'+g.lines.map(function(l){return mkC(l)}).join('<br>')+'</div></div>'}h+='</div>'}
if(e.screenshots&&e.screenshots.length){h+='<div class="se"><div class="st" style="color:#a78bfa">&#128248; Screenshots ('+e.screenshots.length+')</div><div class="ss-grid">';e.screenshots.forEach(function(s){h+='<div style="border:1px solid #1e2433;border-radius:6px;overflow:hidden;background:#0a0d14" title="'+esc2(s.name)+'"><img src="data:image/png;base64,'+s.data+'" onclick="ssV(this.src)"></div>'});h+='</div></div>'}
h+='<div id="seqSecD" style="display:none;margin-top:4px"><div class="se" style="margin-bottom:0"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div class="st" style="color:#a78bfa;margin:0">&#128202; Sequence Diagram</div><button class="btn-cd" id="seqCpBtnD" onclick="cpPumlD()">&#128203; Copy PlantUML</button></div><textarea id="seqTxtD" oninput="schSeqD()" style="width:100%;height:130px;background:#0a0d14;border:1px solid #1e2433;border-radius:6px;color:#e2e8f0;font-family:Consolas,monospace;font-size:12px;padding:8px;resize:vertical;outline:none;margin-bottom:8px"></textarea><div id="seqSvgD" style="overflow-x:auto;background:#0a0d14;border:1px solid #1e2433;border-radius:6px;padding:12px;min-height:60px"></div></div></div>';
h+='<div class="se"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div class="st" style="color:#94a3b8;margin:0">All Valid Logs ('+e.allLines.length+' lines)</div><button class="btn-cd" onclick="cpAllLogsD()">&#128203; Copy All</button></div><div class="lb" id="allLogsD">'+e.allLines.map(function(l,i){var ln=(e.lineNumbers&&e.lineNumbers[i])?e.lineNumbers[i]:(i+1);return'<span style="color:#334155;min-width:30px;display:inline-block;text-align:right;margin-right:10px;user-select:none">L'+ln+'</span>'+mkC(l)}).join('<br>')+'</div></div>';
h+='</div>';
document.getElementById('mc2').innerHTML=h;document.getElementById('md').classList.add('op')}
function tgSeqD(){var sec=document.getElementById('seqSecD'),btn=document.getElementById('seqBtnD');if(!sec||!curE2)return;if(sec.style.display==='none'){sec.style.display='block';btn.style.color='#a78bfa';btn.style.borderColor='rgba(167,139,250,0.5)';var p=genPuml(curE2);document.getElementById('seqTxtD').value=p;upSeqD();setTimeout(function(){sec.scrollIntoView({behavior:'smooth',block:'start'})},50)}else{sec.style.display='none';btn.style.color='';btn.style.borderColor=''}}
function schSeqD(){clearTimeout(window._stD);window._stD=setTimeout(upSeqD,600)}
function upSeqD(){var t=document.getElementById('seqTxtD');if(t)document.getElementById('seqSvgD').innerHTML=rSeqSVG(t.value)}
function cpPumlD(){var t=document.getElementById('seqTxtD').value;navigator.clipboard.writeText(t).then(function(){var b=document.getElementById('seqCpBtnD');if(b){var o=b.textContent;b.textContent='✓ Copied!';setTimeout(function(){b.textContent=o},1500)}}).catch(function(){})}
function cpTxt(txt){navigator.clipboard.writeText(txt||'').then(function(){showT('Copied!')}).catch(function(){})}
function cpAllLogsD(){var el=document.getElementById('allLogsD');if(el)cpTxt(el.innerText)}
function cpConvD(btn){cpTxt((btn&&btn.getAttribute('data-convid'))||'')}
function showT(msg){var d=document.createElement('div');d.style='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#34d399;color:#064e3b;padding:10px 22px;border-radius:8px;font-weight:600;z-index:9999;pointer-events:none';d.textContent=msg;document.body.appendChild(d);setTimeout(function(){d.remove()},1200)}
function genPuml(e){var lines=e.allLines||[],items=[];function exV(ln,m){if(m&&m[1])return m[1].trim();if(m&&m.index!==undefined)return ln.substring(m.index).trim();return ln.trim()}
function pumlT(puml){if(!puml)return[];return Array.isArray(puml)?puml:[puml]}
function patS(p){return typeof p==='string'?p:(p&&p.pattern)||''}
function apP(tmpl,val,ln){var isT=tmpl.trimLeft().indexOf('title')===0;if(isT||tmpl.indexOf('{value}')<0)return tmpl.replace('{value}',val);var ci=tmpl.lastIndexOf(': ');var lbl=(ci>=0?tmpl.substring(ci+2):tmpl).replace('{value}',val);var pfx='L'+ln+': '+lbl;return ci>=0?tmpl.substring(0,ci+2)+pfx:pfx}
for(var i=0;i<lines.length;i++){var line=lines[i];var lineNum=(e.lineNumbers&&e.lineNumbers[i])?e.lineNumbers[i]:(i+1);
if(C&&C.utterance_patterns){for(var uk in C.utterance_patterns){var uc=C.utterance_patterns[uk];if(!uc.PlantUML)continue;try{var um=line.match(new RegExp(uc.pattern));if(um){var uv=exV(line,um);pumlT(uc.PlantUML).forEach(function(tmpl){var isT=tmpl.trimLeft().indexOf('title')===0;items.push({text:apP(tmpl,uv,lineNum),isTitle:isT})})}}catch(x){}}}
if(C&&C.clickable_patterns){for(var ck in C.clickable_patterns){var cc=C.clickable_patterns[ck];if(!cc.PlantUML)continue;try{var cm2=line.match(new RegExp(cc.pattern));if(cm2){var cv=exV(line,cm2);pumlT(cc.PlantUML).forEach(function(tmpl){items.push({text:apP(tmpl,cv,lineNum),isTitle:false})})}}catch(x){}}}
if(C&&C.pattern_groups){for(var gk in C.pattern_groups){var grp=C.pattern_groups[gk];for(var pi=0;pi<(grp.patterns||[]).length;pi++){var pEnt=grp.patterns[pi];var ps=patS(pEnt);var ePuml=(typeof pEnt==='object'&&pEnt.PlantUML)?pEnt.PlantUML:grp.PlantUML;if(!ps||!ePuml)continue;try{var gm=line.match(new RegExp(ps));if(gm){var gv=exV(line,gm);pumlT(ePuml).forEach(function(tmpl){items.push({text:apP(tmpl,gv,lineNum),isTitle:false})});break}}catch(x){}}}}
}
var titles=items.filter(function(p){return p.isTitle}).map(function(p){return p.text});
var rest=items.filter(function(p){return!p.isTitle}).map(function(p){return p.text});
return['@startuml'].concat(titles).concat(rest).concat(['@enduml']).join('\\n')}
function rSeqSVG(src){var lines=src.split('\\n').map(function(l){return l.trim()}).filter(function(l){return l&&l!=='@startuml'&&l!=='@enduml'});var title='',pOrd=[],pSet={},msgs=[];for(var i=0;i<lines.length;i++){var l=lines[i];if(l.indexOf('title ')===0){title=l.slice(6).trim();continue}var nm=l.match(/^note\s+(right|left|over)\s*([^:]*)\s*:\s*(.*)$/i);if(nm){var nPos=nm[1].toLowerCase();var nParts=nm[2].trim()?nm[2].split(',').map(function(p){return p.trim()}).filter(Boolean):[];msgs.push({type:'note',pos:nPos,parts:nParts,lb:nm[3].trim(),dashed:false});continue}var f,t,lb,dashed=false;var rm=l.match(/^(\S+)\s*(-+>>?[ox]?|[ox]?-+>>?[ox]?)\s+([^:\s]+)\s*:\s*(.*)$/);if(rm){f=rm[1].trim();t=rm[3].trim();lb=rm[4].trim();dashed=rm[2].indexOf('--')>=0}else{var lm=l.match(/^(\S+)\s*(<<?-+[<]?)\s+([^:\s]+)\s*:\s*(.*)$/);if(lm){f=lm[3].trim();t=lm[1].trim();lb=lm[4].trim();dashed=lm[2].indexOf('--')>=0}else{var om=l.match(/^(\S+)\s*-(.*)->\s*(\S+)$/);if(om){f=om[1].trim();lb=om[2].trim();t=om[3].trim()}}}if(f&&t){if(!pSet[f]){pSet[f]=1;pOrd.push(f)}if(!pSet[t]){pSet[t]=1;pOrd.push(t)}msgs.push({f:f,t:t,lb:lb||'',dashed:dashed})}}
if(!pOrd.length)return'<div style="color:#64748b;font-size:12px;padding:16px;text-align:center">No sequence arrows found.</div>';
function ev(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
var PAD=40,PW=150,PH=34,BASE_MH=54,FONT=11,NOTE_MAX=80,LH=13,FK=8;
function wL(lb,max){if(!lb||lb.length<=max)return[lb||''];var r=[],ws=lb;while(ws.length>max){r.push(ws.slice(0,max));ws=ws.slice(max);}r.push(ws);return r}
// Arrow labels: no wrapping (show full text). Notes: wrap at NOTE_MAX chars.
var mLines=msgs.map(function(m){return m.type==='note'?wL(m.lb,NOTE_MAX):[m.lb||'']});
var rH=mLines.map(function(ls){return BASE_MH+(ls.length-1)*LH});
var totMH=rH.reduce(function(a,b){return a+b},0);
var arrowLns=[];msgs.forEach(function(m,i){if(m.type!=='note')mLines[i].forEach(function(ln){arrowLns.push(ln)})});
var maxChunk=Math.max(10,arrowLns.length?Math.max.apply(null,arrowLns.map(function(l){return l.length})):10);
var GAP=Math.max(220,Math.round(maxChunk*6.5)+60);
var N=pOrd.length;var cx={};pOrd.forEach(function(p,i){cx[p]=PAD+PW/2+i*GAP});
msgs.forEach(function(msg,i){if(msg.type!=='note')return;var wls=mLines[i];var maxNL=Math.max.apply(null,[10].concat(wls.map(function(l){return l.length})));var NW=Math.max(400,Math.round(maxNL*7)+20);var NH=12+wls.length*LH+12;var nx=0,nw=NW;if(msg.pos==='right'){nx=Math.max.apply(null,pOrd.map(function(p){return cx[p]}))+PW/2+10}else if(msg.pos==='left'){nx=Math.min.apply(null,pOrd.map(function(p){return cx[p]}))-PW/2-NW-10}else{if(msg.parts.length>=2){var x1=cx[msg.parts[0]]!=null?cx[msg.parts[0]]:cx[pOrd[0]];var x2=cx[msg.parts[1]]!=null?cx[msg.parts[1]]:cx[pOrd[N-1]];nx=Math.min(x1,x2)-PW/2;nw=Math.max(NW,Math.abs(x2-x1)+PW)}else{var px=msg.parts[0]&&cx[msg.parts[0]]!=null?cx[msg.parts[0]]:cx[pOrd[Math.floor((N-1)/2)]];nx=px-NW/2}}msg._nx=nx;msg._nw=nw;msg._nh=NH});
var xShift=0;msgs.forEach(function(msg){if(msg.type==='note'&&msg._nx<PAD)xShift=Math.max(xShift,PAD-msg._nx)});
if(xShift>0){pOrd.forEach(function(p){cx[p]+=xShift});msgs.forEach(function(msg){if(msg.type==='note')msg._nx+=xShift})}
var baseW=PAD*2+(N-1)*GAP+PW+xShift;var extraW=0;msgs.forEach(function(msg){if(msg.type==='note')extraW=Math.max(extraW,msg._nx+msg._nw-(baseW-PAD))});
var W=baseW+Math.max(0,extraW);var tH=title?40:0,H=tH+PAD/2+PH+totMH+PH+PAD/2;
var s='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" style="display:block;min-width:'+W+'px">';s+='<rect width="'+W+'" height="'+H+'" fill="#0a0d14"/>';if(title)s+='<text x="'+(W/2)+'" y="28" text-anchor="middle" font-size="14" font-weight="700" fill="#e2e8f0" font-family="Segoe UI,system-ui,sans-serif">'+ev(title)+'</text>';var topY=tH+PAD/2;pOrd.forEach(function(p){var x=cx[p]-PW/2;s+='<rect x="'+x+'" y="'+topY+'" width="'+PW+'" height="'+PH+'" rx="5" fill="#0f1219" stroke="#2a3a5c" stroke-width="1.5"/><text x="'+cx[p]+'" y="'+(topY+PH/2+5)+'" text-anchor="middle" font-size="'+(FONT+1)+'" font-weight="600" fill="#60dcfa" font-family="Consolas,monospace">'+ev(p)+'</text>'});var llY1=topY+PH,llY2=llY1+totMH;pOrd.forEach(function(p){s+='<line x1="'+cx[p]+'" y1="'+llY1+'" x2="'+cx[p]+'" y2="'+llY2+'" stroke="#1e2433" stroke-width="1.5" stroke-dasharray="6,4"/>'});
var cumY=llY1;msgs.forEach(function(msg,i){var rh=rH[i],wls=mLines[i],tl=wls.length;var yArr=cumY+rh*0.5;cumY+=rh;if(msg.type==='note'){var nx=msg._nx,NW=msg._nw,NH=msg._nh,ny=yArr-NH/2;var txMid=nx+NW/2,ty0n=ny+14;s+='<polygon points="'+nx+','+ny+' '+(nx+NW-FK)+','+ny+' '+(nx+NW)+','+(ny+FK)+' '+(nx+NW)+','+(ny+NH)+' '+nx+','+(ny+NH)+'" fill="#1a2010" stroke="#fbbf24" stroke-width="1.5"/>';s+='<polygon points="'+(nx+NW-FK)+','+ny+' '+(nx+NW)+','+(ny+FK)+' '+(nx+NW-FK)+','+(ny+FK)+'" fill="#4a3800" stroke="#fbbf24" stroke-width="1"/>';s+='<text text-anchor="middle" font-size="'+FONT+'" fill="#fbbf24" font-family="Consolas,monospace">';wls.forEach(function(ln,li){s+='<tspan x="'+txMid+'" y="'+(ty0n+li*LH)+'">'+ev(ln)+'</tspan>'});s+='</text>'}else{var x1=cx[msg.f]!=null?cx[msg.f]:PAD+PW/2,x2=cx[msg.t]!=null?cx[msg.t]:PAD+PW/2;var clr=msg.dashed?'#7dd3a8':'#60dcfa';var da=msg.dashed?' stroke-dasharray="6,4"':'';if(msg.f===msg.t){var rx=x1+58;s+='<path d="M'+x1+','+(yArr-14)+' C'+rx+','+(yArr-14)+' '+rx+','+(yArr+14)+' '+x1+','+(yArr+14)+'" fill="none" stroke="#a78bfa" stroke-width="1.5"'+da+'/>';s+='<polygon points="'+x1+','+(yArr+14)+' '+(x1-6)+','+(yArr+6)+' '+(x1+6)+','+(yArr+6)+'" fill="#a78bfa"/>';var ty0s=yArr-(tl-1)*LH/2;s+='<text font-size="'+FONT+'" fill="#a78bfa" font-family="Consolas,monospace">';wls.forEach(function(ln,li){s+='<tspan x="'+(rx+6)+'" y="'+(ty0s+li*LH)+'">'+ev(ln)+'</tspan>'});s+='</text>'}else{var d=x2>x1?1:-1;s+='<line x1="'+x1+'" y1="'+yArr+'" x2="'+x2+'" y2="'+yArr+'" stroke="'+clr+'" stroke-width="1.5"'+da+'/>';s+='<polygon points="'+x2+','+yArr+' '+(x2-d*10)+','+(yArr-5)+' '+(x2-d*10)+','+(yArr+5)+'" fill="'+clr+'"/>';var midX=(x1+x2)/2,ty0=yArr-tl*LH;s+='<text text-anchor="middle" font-size="'+FONT+'" fill="#e2e8f0" font-family="Consolas,monospace">';wls.forEach(function(ln,li){s+='<tspan x="'+midX+'" y="'+(ty0+li*LH)+'">'+ev(ln)+'</tspan>'});s+='</text>'}}});
pOrd.forEach(function(p){var x=cx[p]-PW/2;s+='<rect x="'+x+'" y="'+llY2+'" width="'+PW+'" height="'+PH+'" rx="5" fill="#0f1219" stroke="#2a3a5c" stroke-width="1.5"/><text x="'+cx[p]+'" y="'+(llY2+PH/2+5)+'" text-anchor="middle" font-size="'+(FONT+1)+'" font-weight="600" fill="#60dcfa" font-family="Consolas,monospace">'+ev(p)+'</text>'});s+='</svg>';return s}
var _crData=null;function initCR(e,th){e.preventDefault();_crData={th:th,x:e.clientX,w:th.offsetWidth};document.addEventListener('mousemove',doCR);document.addEventListener('mouseup',stopCR)}
function doCR(e){if(!_crData)return;var w=Math.max(60,_crData.w+e.clientX-_crData.x);_crData.th.style.width=w+'px';_crData.th.style.minWidth=w+'px'}
function stopCR(){_crData=null;document.removeEventListener('mousemove',doCR);document.removeEventListener('mouseup',stopCR)}
function ssV(src){var d=document.createElement('div');d.className='ssv';d.onclick=function(){d.remove()};d.innerHTML='<img src="'+src+'">';document.body.appendChild(d)}
function cm(){document.getElementById('md').classList.remove('op')}
function loadManual(f){var r=new FileReader();r.onload=function(ev){try{var data=JSON.parse(ev.target.result);C=data.config;S=data.stats;totalChunks=data.totalChunks||1;totalEntries=data.totalEntries||data.entries.length;D=data.entries;loadedChunks=1;if(C&&C.table_columns)C.table_columns.forEach(function(col){cFil[col.key]=''});init2()}catch(x){alert('Invalid JSON: '+x.message)}};r.readAsText(f)}
document.addEventListener('keydown',function(e){if(e.key==='Escape')cm()});
window.onload=async function(){try{await loadChunk(0);init2()}catch(err){document.getElementById('al').style.display='none';document.getElementById('fp').style.display=''}};
<\/script></body></html>`;
}

function resetApp() {
    entries = []; filteredData = []; sortCol = null; sortDir = 'asc'; currentFileName = null; currentFilePath = null; currentEncoding = null; currentRawText = null;
    tablePageSize = 50;
    const psSel = document.getElementById('tablePageSizeSelect');
    if (psSel) psSel.value = '50';
    const cntLbl = document.getElementById('tableCountLabel');
    if (cntLbl) cntLbl.textContent = '';
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