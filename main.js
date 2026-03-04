const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const { pipeline } = require("stream/promises");
const { Transform } = require("stream");
const jschardet = require("jschardet");

let activeFileStream = null;

// --- App Logging ---
const LOG_FILE_NAME = 'vila-app.log';
function getLogPath() {
  try {
    return path.join(app.getPath('userData'), LOG_FILE_NAME);
  } catch (e) {
    // Fallback for when app is not ready
    return path.join(process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share"), 'vila-app.log');
  }
}

function writeToLog(level, message, ...args) {
  const logPath = getLogPath();
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  const details = args.length > 0 ? args.map(arg => {
    if (arg instanceof Error) return arg.stack;
    return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg;
  }).join('\n') + '\n' : '';

  try {
    fs.appendFileSync(logPath, formattedMessage + details);
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
}

// IPC handler for logging from renderer
ipcMain.on('log-message', (event, { level, message, args }) => {
  writeToLog(level, message, ...args);
});

// IPC handler to open the log file
ipcMain.handle('open-log-file', async () => {
  const logPath = getLogPath();
  try {
    await shell.openPath(logPath);
  } catch(e) {
    writeToLog('error', 'Failed to open log file via shell', e);
    // Fallback for some systems
    shell.showItemInFolder(logPath);
  }
});
// --- End App Logging ---

// Configure autoUpdater to use VILA_Release repository
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'simpsonys',
  repo: 'VILA_Release'
});

const CONFIG_NAME = "pattern_config.json";

function getConfigPath() {
  return path.join(app.getPath("userData"), CONFIG_NAME);
}

function ensureConfig() {
  const userDataPath = app.getPath("userData");
  const configPath = path.join(userDataPath, CONFIG_NAME);
  
  // 1. Ensure default pattern_config.json
  if (!fs.existsSync(configPath)) {
    const defaultPath = path.join(__dirname, "default_config.json");
    if (fs.existsSync(defaultPath)) {
      fs.copyFileSync(defaultPath, configPath);
      console.log("Created default config at:", configPath);
    }
  }

  // 2. Copy bundled presets to userData if they don't exist
  try {
    const bundledFiles = fs.readdirSync(__dirname);
    const bundledPresets = bundledFiles.filter(f => /^Preset\d+_.+_pattern_config\.json$/.test(f));
    
    bundledPresets.forEach(file => {
      const destPath = path.join(userDataPath, file);
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(path.join(__dirname, file), destPath);
        console.log("Copied bundled preset:", file);
      }
    });
  } catch (err) {
    console.error("Failed to copy bundled presets:", err);
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
  // open developer tools automatically (helps diagnose startup issues)
  // This will detach so the main window is unobstructed.
  // win.webContents.openDevTools({ mode: 'detach' });
  win.loadFile("index.html");
}



// Track current config file name
let currentConfigFile = CONFIG_NAME;

// IPC: Load config (returns {config, fileName})
ipcMain.handle("load-config", async () => {
  const configPath = ensureConfig();
  try {
    const data = fs.readFileSync(configPath, "utf-8");
    return { config: JSON.parse(data), fileName: currentConfigFile };
  } catch (e) {
    return null;
  }
});

// IPC: List preset config files in userData folder
ipcMain.handle("list-presets", async () => {
  try {
    const userDataPath = app.getPath("userData");
    const files = fs.readdirSync(userDataPath);
    // Match files like Preset0_Name_pattern_config.json or pattern_config.json
    const presets = files.filter(f => 
      /^Preset\d+_.+_pattern_config\.json$/.test(f) || f === CONFIG_NAME
    ).sort();
    return presets;
  } catch (e) {
    console.error("Failed to list presets:", e);
    return [];
  }
});

// IPC: Switch to a different preset config
ipcMain.handle("switch-preset", async (event, fileName) => {
  try {
    const configPath = path.join(app.getPath("userData"), fileName);
    if (!fs.existsSync(configPath)) {
      throw new Error(`Preset file not found: ${fileName}`);
    }
    const data = fs.readFileSync(configPath, "utf-8");
    currentConfigFile = fileName;
    return { config: JSON.parse(data), fileName };
  } catch (e) {
    console.error("Failed to switch preset:", e);
    throw e;
  }
});

// IPC: Add custom preset via file dialog
ipcMain.handle("add-custom-preset", async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: "Select Custom Preset Config File",
      properties: ["openFile"],
      filters: [
        { name: "JSON Config", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;

    const srcPath = result.filePaths[0];
    const srcName = path.basename(srcPath);
    
    // Validate JSON
    const data = fs.readFileSync(srcPath, "utf-8");
    JSON.parse(data); // throws if invalid

    // Determine preset filename
    const userDataPath = app.getPath("userData");
    let destName = srcName;
    
    // If file doesn't follow preset naming convention, auto-generate one
    if (!/^Preset\d+_.+_pattern_config\.json$/.test(srcName)) {
      const existing = fs.readdirSync(userDataPath).filter(f => /^Preset\d+_/.test(f));
      const nextNum = existing.length > 0 
        ? Math.max(...existing.map(f => parseInt(f.match(/^Preset(\d+)/)?.[1] || '0'))) + 1 
        : 1;
      const baseName = path.basename(srcName, '.json').replace(/[^a-zA-Z0-9_-]/g, '_');
      destName = `Preset${nextNum}_${baseName}_pattern_config.json`;
    }
    
    const destPath = path.join(userDataPath, destName);
    fs.copyFileSync(srcPath, destPath);
    console.log("Custom preset added:", destName);
    
    return { success: true, fileName: destName };
  } catch (e) {
    console.error("Failed to add custom preset:", e);
    throw e;
  }
});

// IPC: Open config file location
ipcMain.handle("open-config-folder", async () => {
  const configPath = getConfigPath();
  const { shell } = require("electron");
  shell.showItemInFolder(configPath);
});

// IPC: Open file dialog and stream content to renderer
ipcMain.handle("open-and-read-file", async (event, forceFilePath) => {
  let filePath = forceFilePath;
  
  if (!filePath) {
    writeToLog('info', 'File open dialog initiated by renderer (streaming mode).');
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "Log Files", extensions: ["log", "txt", "text"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (result.canceled || !result.filePaths[0]) {
      writeToLog('info', 'File open dialog canceled.');
      return { success: false, reason: 'Canceled' };
    }
    filePath = result.filePaths[0];
  }
  
  const fileName = path.basename(filePath);
  writeToLog('info', `File selected for streaming: ${filePath}`);

  try {
    // Detect encoding from first 4KB
    const fd = fs.openSync(filePath, 'r');
    const initialBuffer = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, initialBuffer, 0, 4096, 0);
    fs.closeSync(fd);

    const detected = jschardet.detect(initialBuffer.slice(0, bytesRead));
    const encoding = detected.encoding || 'utf-8';
    writeToLog('info', `Detected encoding for stream: ${encoding} with confidence: ${detected.confidence}`);

    const stats = fs.statSync(filePath);
    const fileSize = stats.size;

    // Notify renderer that file loading started
    event.sender.send('file-content-loaded', {
      success: true,
      filePath,
      fileName,
      encoding,
      fileSize,
      isStreaming: true
    });

    // Close any existing stream
    if (activeFileStream) {
      activeFileStream.destroy();
    }

    const { TextDecoder } = require('util');
    const decoder = new TextDecoder(encoding);
    
    activeFileStream = fs.createReadStream(filePath);
    
    activeFileStream.on('data', (chunk) => {
      // Convert buffer chunk to string using detected encoding
      const textChunk = decoder.decode(chunk, { stream: true });
      event.sender.send('file-data-chunk', {
        text: textChunk,
        byteLength: chunk.length
      });
    });

    activeFileStream.on('end', () => {
      // Final flush
      const finalChunk = decoder.decode();
      if (finalChunk) {
        event.sender.send('file-data-chunk', finalChunk);
      }
      event.sender.send('file-read-complete');
      activeFileStream = null;
      writeToLog('info', `Streaming completed for: ${fileName}`);
    });

    activeFileStream.on('error', (err) => {
      writeToLog('error', 'Error during file streaming.', err);
      event.sender.send('file-read-error', err.message);
      activeFileStream = null;
    });

    return { success: true };

  } catch (err) {
    writeToLog('error', 'Error initializing file stream in main process.', err);
    return { success: false, reason: err.message, stack: err.stack };
  }
});

// IPC: Cancel active file streaming
ipcMain.on("cancel-file-read", () => {
  if (activeFileStream) {
    writeToLog('info', 'File streaming canceled by renderer.');
    activeFileStream.destroy();
    activeFileStream = null;
  }
});

// IPC: Save export files with custom filename (Save As dialog)
ipcMain.handle("save-export", async (event, { jsonData, htmlData, baseName }) => {
  const now = new Date();
  const timestamp = now.getFullYear().toString().slice(2) +
                    String(now.getMonth() + 1).padStart(2, '0') +
                    String(now.getDate()).padStart(2, '0') +
                    String(now.getHours()).padStart(2, '0') +
                    String(now.getMinutes()).padStart(2, '0');
  const defaultFileName = baseName || `${timestamp}_report`;
  
  const result = await dialog.showSaveDialog({
    title: "Export Analysis Report as HTML",
    defaultPath: `${defaultFileName}_report.html`,
    filters: [
      { name: "HTML Report", extensions: ["html"] },
      { name: "All Files", extensions: ["*"] },
    ],
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

// IPC: Toggle Developer Tools
ipcMain.handle("toggle-devtools", () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.webContents.toggleDevTools();
  }
});

// IPC: Open text in browser (temporary file)
ipcMain.handle("open-in-browser", async (event, text) => {
  try {
    const tempPath = path.join(app.getPath("temp"), `villa_log_${Date.now()}.txt`);
    fs.writeFileSync(tempPath, text, "utf8");
    const { shell } = require("electron");
    await shell.openExternal(`file://${tempPath}`);
    return true;
  } catch (e) {
    console.error("Failed to open in browser:", e);
    return false;
  }
});

// IPC: Get screenshots from log file directory
ipcMain.handle("get-screenshots", async (event, args) => {
  const logFilePath = typeof args === 'string' ? args : args.logFilePath;
  const utterance = typeof args === 'string' ? null : args.utterance;

  writeToLog('info', `get-screenshots: Searching for screenshots. Utterance: "${utterance}", LogPath: ${logFilePath}`);

  if (!logFilePath) {
    writeToLog('warn', 'get-screenshots: logFilePath is missing.');
    return [];
  }
  try {
    const dirPath = path.dirname(logFilePath);
    writeToLog('info', `get-screenshots: Searching for screenshot folder in: ${dirPath}`);
    
    // Check for various screenshot folder names (case-insensitive search)
    const possibleNames = ["screenshot", "screenShot", "screenshots", "ScreenShot", "ScreenShots"];
    let screenshotDir = null;

    for (const name of possibleNames) {
      const p = path.join(dirPath, name);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        screenshotDir = p;
        writeToLog('info', `get-screenshots: Found screenshot folder: ${screenshotDir}`);
        break;
      }
    }

    if (!screenshotDir) {
      writeToLog('warn', `get-screenshots: No standard screenshot folder found in ${dirPath}. Falling back to directory scan.`);
      // Fallback: search directory for any folder that looks like screenshots
      try {
        const items = fs.readdirSync(dirPath);
        for (const item of items) {
          if (item.toLowerCase() === "screenshot" || item.toLowerCase() === "screenshots") {
            const p = path.join(dirPath, item);
            if (fs.statSync(p).isDirectory()) {
              screenshotDir = p;
              writeToLog('info', `get-screenshots: Found screenshot folder via fallback scan: ${screenshotDir}`);
              break;
            }
          }
        }
      } catch (e) {
        writeToLog('error', 'get-screenshots: Error during fallback directory scan.', e);
      }
    }

    if (!screenshotDir) {
        writeToLog('warn', 'get-screenshots: No screenshot directory found anywhere.');
        return [];
    }
    
    const files = fs.readdirSync(screenshotDir);
    writeToLog('info', `get-screenshots: Found ${files.length} files in screenshot directory: ${screenshotDir}. Files: [${files.slice(0, 5).join(', ')}${files.length > 5 ? '...' : ''}]`);
    
    // Filter files: start with "발화_" or contain the utterance string
    const utteranceFiles = files.filter(f => {
      const nameLower = f.toLowerCase();
      if (!nameLower.endsWith(".png")) return false;
      if (nameLower.startsWith("발화_")) return true;
      if (utterance) {
        // Create a flexible search pattern: replace spaces/underscores/dashes with a regex that matches any of them
        const baseUtt = utterance.toLowerCase().trim();
        const sanitizedUtt = baseUtt.replace(/[:/\\?*<>|+\-_]/g, " ").replace(/\s+/g, " ").trim();
        
        // Exact match of sanitized version
        if (sanitizedUtt && nameLower.includes(sanitizedUtt)) return true;
        
        // Match with underscores or dashes instead of spaces
        const flexiblePattern = sanitizedUtt.replace(/\s+/g, "[\\s\\-_]");
        if (new RegExp(flexiblePattern).test(nameLower)) return true;

        // Split utterance by spaces and check if first 2-3 words match
        const parts = sanitizedUtt.split(' ').filter(p => p.length > 2);
        if (parts.length >= 2) {
            const partial = parts.slice(0, 3).join(' ');
            if (nameLower.includes(partial)) return true;
        }
      }
      return false;
    }).sort((a, b) => {
      // Improved sorting for filenames like "name_01.png" or "발화_1.png"
      const numA = parseInt(a.match(/(\d+)\.png$/i)?.[1] || a.match(/(\d+)/)?.[0] || '0');
      const numB = parseInt(b.match(/(\d+)\.png$/i)?.[1] || b.match(/(\d+)/)?.[0] || '0');
      if (numA !== numB) return numA - numB;
      return a.localeCompare(b);
    });
    
    writeToLog('info', `get-screenshots: Filtered down to ${utteranceFiles.length} matching screenshots.`);

    return utteranceFiles.map(f => ({
      name: f,
      path: path.join(screenshotDir, f)
    }));
  } catch (e) {
    writeToLog('error', "get-screenshots: A critical error occurred.", e);
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

// IPC: Open detail window for utterance
ipcMain.handle("open-detail-window", async (event, data) => {
  const { utteranceIndex } = data;
  const detailWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    title: `Utterance Detail - ${utteranceIndex}`,
    backgroundColor: "#080a10",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  
  detailWindows.push(detailWindow);

  detailWindow.webContents.once("ready-to-show", () => {
    detailWindow.webContents.send("set-utterance-data", data);
  });
  
  detailWindow.loadFile("index.html", { query: { mode: 'detail' } });
  detailWindow.setMenuBarVisibility(false);

  detailWindow.on("closed", () => {
    detailWindows = detailWindows.filter(win => win !== detailWindow);
  });

  return { windowId: detailWindow.id };
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
let detailWindows = []; // Track open detail windows

// ── Single Instance Lock ──
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    writeToLog('info', `VILA App Started, Version: ${app.getVersion()}`);
    ensureConfig();
    createWindow();
    mainWindow = BrowserWindow.getAllWindows()[0];

    // Main window closing logic
    mainWindow.on("closed", () => {
      // Close all detail windows when main window is closed
      detailWindows.forEach(win => {
        if (!win.isDestroyed()) win.close();
      });
      detailWindows = [];
      mainWindow = null;
    });

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

    autoUpdater.checkForUpdatesAndNotify();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// Update mainWindow reference when new window is created
app.on("window-all-closed", () => {
  mainWindow = null;
  if (process.platform !== "darwin") app.quit();
});
