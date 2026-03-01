const { app, BrowserWindow, ipcMain, dialog } = require("electron");
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

app.whenReady().then(() => {
  ensureConfig();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

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

// IPC: Application version (from package.json)
ipcMain.handle("get-version", () => {
  return app.getVersion();
});
