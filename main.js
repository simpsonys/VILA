const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");

const CONFIG_NAME = "pattern_config.json";

function getConfigPath() {
  return path.join(app.getPath("userData"), CONFIG_NAME);
}

function ensureConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    const defaultPath = path.join(__dirname, "default_config.json");
    if (fs.existsSync(defaultPath)) {
      fs.copyFileSync(defaultPath, configPath);
      console.log("Created default config at:", configPath);
    }
  }
  return configPath;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Voice Interaction Log Analyzer",
    backgroundColor: "#080a10",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile("index.html");
}



// IPC: Load config
ipcMain.handle("load-config", async () => {
  const configPath = ensureConfig();
  try {
    const data = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
});

// IPC: Open config file location
ipcMain.handle("open-config-folder", async () => {
  const configPath = getConfigPath();
  const { shell } = require("electron");
  shell.showItemInFolder(configPath);
});

// IPC: Read file with encoding detection
ipcMain.handle("read-file-buffer", async (event, filePath) => {
  const buffer = fs.readFileSync(filePath);
  return buffer;
});

// IPC: Open file dialog
ipcMain.handle("open-file-dialog", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "Log Files", extensions: ["log", "txt", "text"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// IPC: Save export files
ipcMain.handle("save-export", async (event, { jsonData, htmlData, baseName }) => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select export destination folder",
  });
  if (result.canceled) return null;
  const dir = result.filePaths[0];
  const jsonPath = path.join(dir, `${baseName}_data.json`);
  const htmlPath = path.join(dir, `${baseName}_report.html`);
  fs.writeFileSync(jsonPath, jsonData, "utf-8");
  fs.writeFileSync(htmlPath, htmlData, "utf-8");
  return { jsonPath, htmlPath };
});

// IPC: Application version (from package.json + build timestamp)
ipcMain.handle("get-version", () => {
  const baseVersion = app.getVersion();
  const buildTimePath = path.join(__dirname, "build-time.json");
  try {
    if (fs.existsSync(buildTimePath)) {
      const buildData = JSON.parse(fs.readFileSync(buildTimePath, "utf-8"));
      return `${baseVersion}-${buildData.buildTime}`;
    }
  } catch (e) {
    console.error("Failed to read build time:", e);
  }
  return baseVersion;
});

// IPC: Get screenshots from log file directory
ipcMain.handle("get-screenshots", async (event, logFilePath) => {
  if (!logFilePath) return [];
  try {
    const dirPath = path.dirname(logFilePath);
    const screenshotDir = path.join(dirPath, "screenshot");
    if (!fs.existsSync(screenshotDir)) return [];
    
    const files = fs.readdirSync(screenshotDir);
    const utteranceFiles = files.filter(f => /^발화_\d+\.png$/i.test(f)).sort();
    
    return utteranceFiles.map(f => ({
      name: f,
      path: path.join(screenshotDir, f)
    }));
  } catch (e) {
    console.error("Failed to get screenshots:", e);
    return [];
  }
});

// IPC: Read screenshot as base64
ipcMain.handle("read-screenshot", async (event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer.toString("base64");
  } catch (e) {
    console.error("Failed to read screenshot:", e);
    return null;
  }
});

// IPC: Open URL in external browser
ipcMain.handle("open-external", async (event, url) => {
  try {
    const { shell } = require("electron");
    await shell.openExternal(url);
    return true;
  } catch (e) {
    console.error("Failed to open URL:", e);
    return false;
  }
});

// IPC: Check for updates
ipcMain.handle("check-updates", async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return result;
  } catch (e) {
    console.error("Failed to check updates:", e);
    return null;
  }
});

// IPC: Download update
ipcMain.handle("download-update", async () => {
  try {
    await autoUpdater.downloadUpdate();
    return true;
  } catch (e) {
    console.error("Failed to download update:", e);
    return false;
  }
});

// IPC: Install and restart
ipcMain.handle("install-update", async () => {
  autoUpdater.quitAndInstall();
});

// Auto-updater event listeners
let mainWindow;

app.whenReady().then(() => {
  ensureConfig();
  mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) {
    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      title: "Voice Interaction Log Analyzer",
      backgroundColor: "#080a10",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    mainWindow = win;
  }

  // Auto-updater events
  autoUpdater.on("update-available", (info) => {
    console.log("Update available:", info.version);
    if (mainWindow) {
      mainWindow.webContents.send("update-available", info);
    }
  });

  autoUpdater.on("update-not-available", (info) => {
    console.log("No updates available");
    if (mainWindow) {
      mainWindow.webContents.send("update-not-available", info);
    }
  });

  autoUpdater.on("error", (err) => {
    console.error("Update error:", err);
    if (mainWindow) {
      mainWindow.webContents.send("update-error", err.message);
    }
  });

  autoUpdater.on("download-progress", (progressObj) => {
    if (mainWindow) {
      mainWindow.webContents.send("download-progress", progressObj);
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("Update downloaded:", info.version);
    if (mainWindow) {
      mainWindow.webContents.send("update-downloaded", info);
    }
  });

  createWindow();
  autoUpdater.checkForUpdatesAndNotify();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Update mainWindow reference when new window is created
app.on("window-all-closed", () => {
  mainWindow = null;
  if (process.platform !== "darwin") app.quit();
});
