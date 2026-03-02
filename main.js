const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");

// Configure autoUpdater
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'simpsonys',
  repo: 'VILA_Release'
});

// --- Default Preset Contents ---
const DEFAULT_PRESET_0 = {
  "start_patterns": ["cmd_from_mockapp"],
  "end_patterns": ["GRPC CLOSE OUT"],
  "success_patterns": ["result_code=success"],
  "failure_patterns": ["result_code=fail"],
  "clickable_patterns": {
    "conversationId": { "pattern": "conversationId\\[([^\\]]+)\\]", "url_template": "https://sumologic.bixbydev.com/stg/conversation/?conversationId={value}", "display_name": "ConversationID" },
    "requestId": { "pattern": "requestId\\[([^\\]]+)\\]", "url_template": null, "display_name": "RequestID" }
  },
  "utterance_patterns": {
    "cmd_from_mockapp": { "pattern": "cmd_from_mockapp, ([^\\]]+)", "utterance": "{value}" }
  },
  "pattern_groups": {
    "MakeMetaDataParams": { "name": "MakeMetaDataParams", "patterns": ["MakeMetaDataParams.*", "GetConfig.*"] },
    "Actions": { "name": "Action", "patterns": ["PROCESS ACTION URL.*", "result_code"] },
    "setDialogText": { "name": "setDialogText", "patterns": ["setDialogText.*"] },
    "CapsuleGoal": { "name": "CapsuleGoal", "patterns": ["setExecutionCapsuleGoal.*"] },
    "YT": { "name": "YT", "patterns": ["Dispatching deep link event.*"] }
  },
  "table_columns": [
    { "key": "conversationId", "label": "Conversation ID", "width": "22%", "clickable_key": "conversationId" },
    { "key": "requestId", "label": "Request ID", "width": "12%" },
    { "key": "utterance", "label": "Utterance", "width": "22%", "type": "utterance" },
    { "key": "CapsuleGoal", "label": "CapsuleGoal", "width": "8%", "type": "log" },
    { "key": "result", "label": "Result", "width": "8%", "type": "badge" },
    { "key": "successLine", "label": "Success Match", "width": "28%", "type": "log" }
  ]
};

const DEFAULT_PRESET_1 = {
  "start_patterns": ["GRPC OPEN IN"],
  "end_patterns": ["GRPC CLOSE OUT"],
  "success_patterns": ["result_code=success"],
  "failure_patterns": ["result_code=fail"],
  "clickable_patterns": {
    "conversationId": { "pattern": "conversationId\\[([^\\]]+)\\]", "url_template": "https://sumologic.bixbydev.com/stg/conversation/?conversationId={value}", "display_name": "ConversationID" },
    "requestId": { "pattern": "requestId\\[([^\\]]+)\\]", "url_template": null, "display_name": "RequestID" }
  },
  "utterance_patterns": {
    "kAsr2Response": { "pattern": "kAsr2Response \\[FINAL\\] \\[([^\\]]+)\\]", "utterance": "{value}" }
  },
  "pattern_groups": {
    "MakeMetaDataParams": { "name": "MakeMetaDataParams", "patterns": ["MakeMetaDataParams.*", "GetConfig.*"] },
    "Actions": { "name": "Action", "patterns": ["PROCESS ACTION URL.*", "result_code"] },
    "setDialogText": { "name": "setDialogText", "patterns": ["setDialogText.*"] },
    "CapsuleGoal": { "name": "CapsuleGoal", "patterns": ["setExecutionCapsuleGoal.*"] },
    "YT": { "name": "YT", "patterns": ["Dispatching deep link event.*"] }
  },
  "table_columns": [
    { "key": "conversationId", "label": "Conversation ID", "width": "22%", "clickable_key": "conversationId" },
    { "key": "requestId", "label": "Request ID", "width": "12%" },
    { "key": "utterance", "label": "Utterance", "width": "22%", "type": "utterance" },
    { "key": "CapsuleGoal", "label": "CapsuleGoal", "width": "8%", "type": "log" },
    { "key": "result", "label": "Result", "width": "8%", "type": "badge" },
    { "key": "successLine", "label": "Success Match", "width": "28%", "type": "log" }
  ]
};

function getConfigFolderPath() {
  return app.getPath("userData");
}

// main.js 의 createWindow 함수와 ensureDefaultPresets 부분을 아래처럼 확인/수정해주세요.

function ensureDefaultPresets() {
  const folder = getConfigFolderPath();
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }

  const p0Path = path.join(folder, "Preset0_CmdMyBixby_pattern_config.json");
  const p1Path = path.join(folder, "Preset1_kAsr2Response_pattern_config.json");

  // 파일 목록 확인
  const files = fs.readdirSync(folder);
  // Preset으로 시작하는 json 파일이 하나도 없으면 기본 파일 생성
  const hasPreset = files.some(f => f.startsWith("Preset") && f.endsWith(".json"));

  if (!hasPreset) {
    console.log("No presets found. Creating defaults...");
    fs.writeFileSync(p0Path, JSON.stringify(DEFAULT_PRESET_0, null, 2));
    fs.writeFileSync(p1Path, JSON.stringify(DEFAULT_PRESET_1, null, 2));
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: "Voice Interaction Log Analyzer",
    backgroundColor: "#080a10",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);
  
  // [수정 1] 디버깅을 위해 DevTools를 다시 켭니다. (문제가 해결되면 주석 처리하세요)
  win.webContents.openDevTools({ mode: 'detach' }); 
  
  win.loadFile("index.html");
}


// --- IPC Handlers ---

// List all preset files
ipcMain.handle("list-presets", async () => {
  ensureDefaultPresets();
  const folder = getConfigFolderPath();
  try {
    const files = fs.readdirSync(folder);
    const presets = files
      .filter(f => f.startsWith("Preset") && f.endsWith("_pattern_config.json"))
      .sort(); // Sort by name (Preset0, Preset1...)
    return presets;
  } catch (e) {
    console.error(e);
    return [];
  }
});

// Load a specific config file
ipcMain.handle("load-specific-config", async (event, fileName) => {
  const folder = getConfigFolderPath();
  const filePath = path.join(folder, fileName);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (e) { console.error(e); }
  return null;
});

// Load default (first available) config
ipcMain.handle("load-config", async () => {
  ensureDefaultPresets();
  const folder = getConfigFolderPath();
  const files = fs.readdirSync(folder).filter(f => f.startsWith("Preset") && f.endsWith("_pattern_config.json")).sort();
  if (files.length > 0) {
    // Return both the config and the filename so UI knows what's selected
    const filePath = path.join(folder, files[0]);
    return { config: JSON.parse(fs.readFileSync(filePath, "utf-8")), fileName: files[0] };
  }
  return { config: DEFAULT_PRESET_0, fileName: "Default" };
});

ipcMain.handle("open-config-folder", async () => {
  shell.showItemInFolder(getConfigFolderPath());
});

ipcMain.handle("read-file-buffer", async (event, filePath) => {
  return fs.readFileSync(filePath);
});

ipcMain.handle("open-file-dialog", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Log Files", extensions: ["log", "txt", "text"] }, { name: "All Files", extensions: ["*"] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("save-export", async (event, { jsonData, htmlData, baseName }) => {
  const now = new Date();
  const timestamp = now.getFullYear().toString().slice(2) + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
  const defaultFileName = baseName || `${timestamp}_report`;
  const result = await dialog.showSaveDialog({
    title: "Export Analysis Report",
    defaultPath: `${defaultFileName}_report.html`,
    filters: [{ name: "HTML Report", extensions: ["html"] }, { name: "All Files", extensions: ["*"] }],
  });
  if (result.canceled) return null;
  const htmlPath = result.filePath;
  const dir = path.dirname(htmlPath);
  const basename = path.basename(htmlPath, path.extname(htmlPath));
  const jsonPath = path.join(dir, `${basename}_data.json`);
  fs.writeFileSync(htmlPath, htmlData, "utf-8");
  fs.writeFileSync(jsonPath, jsonData, "utf-8");
  return { jsonPath, htmlPath };
});

ipcMain.handle("get-version", () => {
  const baseVersion = app.getVersion();
  try {
    const buildPath = path.join(__dirname, "build-time.json");
    if (fs.existsSync(buildPath)) {
      return `${baseVersion}-${JSON.parse(fs.readFileSync(buildPath, "utf-8")).buildTime}`;
    }
  } catch (e) {}
  return baseVersion;
});

ipcMain.handle("get-screenshots", async (event, logFilePath) => {
  if (!logFilePath) return [];
  try {
    const dir = path.dirname(logFilePath);
    const ssDir = path.join(dir, "screenshot");
    if (!fs.existsSync(ssDir)) return [];
    return fs.readdirSync(ssDir)
      .filter(f => /^발화_\d+\.png$/i.test(f))
      .sort()
      .map(f => ({ name: f, path: path.join(ssDir, f) }));
  } catch (e) { return []; }
});

ipcMain.handle("read-screenshot", async (event, filePath) => {
  try { return fs.readFileSync(filePath).toString("base64"); } catch (e) { return null; }
});

ipcMain.handle("open-external", async (event, url) => {
  try { await shell.openExternal(url); return true; } catch (e) { return false; }
});

// Open Detail Window - Adds ?mode=detail query param to prevent flickering
ipcMain.handle("open-detail-window", async (event, { utteranceData, utteranceIndex }) => {
  const detailWindow = new BrowserWindow({
    width: 900, height: 700, minWidth: 600, minHeight: 500,
    title: `Utterance Detail - ${utteranceIndex}`,
    backgroundColor: "#080a10",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  
  detailWindow.webContents.once("ready-to-show", () => {
    detailWindow.webContents.send("set-utterance-data", { utteranceData, utteranceIndex });
  });
  
  // Load with query param to trigger loading state immediately
  detailWindow.loadFile("index.html", { query: { mode: 'detail' } });
  detailWindow.setMenuBarVisibility(false);
  return { windowId: detailWindow.id };
});

ipcMain.handle("check-updates", async () => autoUpdater.checkForUpdates());
ipcMain.handle("download-update", async () => { await autoUpdater.downloadUpdate(); return true; });
ipcMain.handle("install-update", async () => autoUpdater.quitAndInstall());

// App Lifecycle
let mainWindow;
app.whenReady().then(() => {
  ensureDefaultPresets();
  createWindow();
  mainWindow = BrowserWindow.getAllWindows()[0];

  autoUpdater.on("update-available", (info) => mainWindow?.webContents.send("update-available", info));
  autoUpdater.on("update-not-available", (info) => mainWindow?.webContents.send("update-not-available", info));
  autoUpdater.on("error", (err) => mainWindow?.webContents.send("update-error", err.message));
  autoUpdater.on("download-progress", (p) => mainWindow?.webContents.send("download-progress", p));
  autoUpdater.on("update-downloaded", (info) => mainWindow?.webContents.send("update-downloaded", info));
  autoUpdater.checkForUpdatesAndNotify();

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => {
  mainWindow = null;
  if (process.platform !== "darwin") app.quit();
});
