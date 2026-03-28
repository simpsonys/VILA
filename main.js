const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, nativeImage } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const { pipeline } = require("stream/promises");
const { Transform } = require("stream");
const jschardet = require("jschardet");
const { spawn, exec } = require("child_process");

let dlogProcess = null;

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
const SETTINGS_NAME = "vila_settings.json";

function loadSettings() {
  try {
    const p = path.join(app.getPath("userData"), SETTINGS_NAME);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (e) {}
  return {};
}
function saveSettings(data) {
  try {
    const p = path.join(app.getPath("userData"), SETTINGS_NAME);
    fs.writeFileSync(p, JSON.stringify({ ...loadSettings(), ...data }, null, 2));
  } catch (e) {}
}

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
      fs.copyFileSync(path.join(__dirname, file), destPath);
      console.log("Updated bundled preset:", file);
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
  win.webContents.on('found-in-page', (e, result) => {
    win.webContents.send('found-in-page', result);
  });
  win.loadFile("index.html");
}



// Track current config file name — initialized after app.ready (app.getPath requires app.ready)
let currentConfigFile = CONFIG_NAME;

// IPC: Load config (returns {config, fileName})
ipcMain.handle("load-config", async () => {
  try {
    const configPath = path.join(app.getPath("userData"), currentConfigFile);
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, "utf-8");
      return { config: JSON.parse(data), fileName: currentConfigFile };
    }
  } catch (e) {}
  // fallback to default
  try {
    const configPath = path.join(app.getPath("userData"), CONFIG_NAME);
    const data = fs.readFileSync(configPath, "utf-8");
    currentConfigFile = CONFIG_NAME;
    return { config: JSON.parse(data), fileName: CONFIG_NAME };
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
    saveSettings({ lastPreset: fileName });
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
      defaultPath: __dirname,
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

// IPC: Delete preset config file
ipcMain.handle("delete-preset", async (event, fileName) => {
  try {
    if (fileName === CONFIG_NAME) {
      throw new Error("Cannot delete default preset");
    }
    const configPath = path.join(app.getPath("userData"), fileName);
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
      console.log(`Preset deleted: ${fileName}`);
      if (currentConfigFile === fileName) {
          currentConfigFile = CONFIG_NAME;
          saveSettings({ lastPreset: CONFIG_NAME });
      }
      return { success: true };
    }
    return { success: false, reason: "File not found" };
  } catch (e) {
    console.error("Failed to delete preset:", e);
    return { success: false, reason: e.message };
  }
});

// IPC: Reset preset config file to factory defaults
ipcMain.handle("reset-preset", async (event, fileName) => {
  try {
    const userDataPath = app.getPath("userData");
    const configPath = path.join(userDataPath, fileName);
    
    let sourcePath;
    if (fileName === CONFIG_NAME) {
      sourcePath = path.join(__dirname, "default_config.json");
    } else {
      sourcePath = path.join(__dirname, fileName);
    }
    
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, configPath);
      console.log(`Preset reset to default: ${fileName}`);
      const data = fs.readFileSync(configPath, "utf-8");
      return { success: true, config: JSON.parse(data) };
    } else {
      return { success: false, reason: "This preset cannot be reset because it is a custom preset." };
    }
  } catch (e) {
    console.error("Failed to reset preset:", e);
    return { success: false, reason: e.message };
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
      let textChunk = decoder.decode(chunk, { stream: true });
      // ── FIX: Normalize CRLF/CR to LF (SDB logs often have mixed line endings)
      textChunk = textChunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      // ── FIX: Resolve literal \n before timestamps (SDB embedded newlines)
      textChunk = textChunk.replace(/\\n(?=\[?\d{2}-\d{2}-\d{4}\s)/g, '\n');
      // ── FIX: Also handle literal \n before logcat-style timestamps (e.g. \n11136.181 E/VOICE_CLIENT)
      textChunk = textChunk.replace(/\\n(?=\d{4,6}\.\d{1,3}\s+[VDIWEF]\/)/g, '\n');
      
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

// IPC: SDB Connect — runs "sdb connect <ip>" then "sdb root on"
ipcMain.handle("sdb-connect", async (event, ip) => {
  if (!ip) return { success: false, error: 'No IP/device specified' };
  return new Promise((resolve) => {
    exec(`sdb connect ${ip}`, (err, stdout, stderr) => {
      const connectOut = (stdout || '') + (stderr || '');
      if (err) {
        resolve({ success: false, error: err.message, connectOutput: connectOut, step: 'connect' });
        return;
      }
      exec('sdb root on', (err2, stdout2, stderr2) => {
        const rootOut = (stdout2 || '') + (stderr2 || '');
        resolve({
          success: !err2,
          connectOutput: connectOut.trim(),
          rootOutput: rootOut.trim(),
          error: err2 ? err2.message : null,
        });
      });
    });
  });
});

// IPC: Start sdb dlogutil stream
ipcMain.on("start-log-stream", (event, command) => {
  if (dlogProcess) {
    writeToLog('warn', 'start-log-stream called but dlogProcess already exists.');
    return;
  }

  if (!command) {
    writeToLog('error', 'start-log-stream called with no command.');
    return;
  }

  const parts = command.split(' ');
  const cmd = parts[0];
  const args = parts.slice(1);

  try {
    writeToLog('info', `Attempting to start command: ${cmd} with args: ${args.join(' ')}`);
    dlogProcess = spawn(cmd, args, { cwd: __dirname });

    dlogProcess.stdout.on('data', (data) => {
      event.sender.send('log-stream-data', data.toString());
    });

    dlogProcess.stderr.on('data', (data) => {
      writeToLog('error', `sdb stderr: ${data.toString()}`);
      event.sender.send('log-stream-error', data.toString());
    });

    dlogProcess.on('close', (code) => {
      writeToLog('info', `sdb process exited with code ${code}`);
      event.sender.send('log-stream-closed', code);
      dlogProcess = null;
    });
    
    dlogProcess.on('error', (err) => {
      writeToLog('error', 'Failed to start sdb process.', err);
      event.sender.send('log-stream-error', `Failed to start sdb. Make sure 'sdb' is in your system's PATH. Error: ${err.message}`);
      dlogProcess = null;
    });

  } catch (err) {
    writeToLog('error', 'Exception while trying to spawn sdb.', err);
    event.sender.send('log-stream-error', `Error spawning sdb process: ${err.message}`);
    dlogProcess = null;
  }
});

// IPC: Stop sdb dlogutil stream
ipcMain.on("stop-log-stream", () => {
  if (dlogProcess) {
    writeToLog('info', 'Stopping dlogProcess.');
    dlogProcess.kill();
    dlogProcess = null;
  }
});

// IPC: Select a folder for screenshots
ipcMain.handle("select-screenshot-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// IPC: Init default screenshot folder
ipcMain.handle("init-screenshot-folder", async () => {
  const storagePath = path.join(app.getPath("userData"), "ScreenshotStorage");
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
  }
  return storagePath;
});

// IPC: Copy screenshot to clipboard
ipcMain.handle("copy-screenshot-to-clipboard", async (event, filePath) => {
  try {
    const image = nativeImage.createFromPath(filePath);
    clipboard.writeImage(image);
    return true;
  } catch (err) {
    writeToLog('error', 'Failed to copy screenshot to clipboard', err);
    return false;
  }
});

// IPC: Save screenshot as
ipcMain.handle("save-screenshot-as", async (event, filePath) => {
  try {
    const defaultName = path.basename(filePath);
    const result = await dialog.showSaveDialog({
      title: "Save Screenshot As",
      defaultPath: defaultName,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }]
    });
    if (result.canceled || !result.filePath) return null;
    fs.copyFileSync(filePath, result.filePath);
    return result.filePath;
  } catch (err) {
    writeToLog('error', 'Failed to save screenshot as', err);
    return null;
  }
});

// IPC: Reveal screenshot in explorer
ipcMain.handle("reveal-screenshot-in-explorer", async (event, filePath) => {
  try {
    shell.showItemInFolder(filePath);
    return true;
  } catch (err) {
    writeToLog('error', 'Failed to reveal screenshot', err);
    return false;
  }
});

// IPC: Run screenshot command
ipcMain.handle("run-screenshot-command", async (event, { command, savePath, customFileName }) => {
  const commands = command.split(/\r?\n/).filter(c => c.trim() !== '');
  let finalPath = null;
  // Ensure save directory exists (e.g., utterance-file-based screenshot subfolder)
  try { fs.mkdirSync(savePath, { recursive: true }); } catch (_) {}

  for (let cmd of commands) {
    // Replace placeholder for filename
    if (cmd.includes("yymmdd_hhmmss.png")) {
      let fileName;
      if (customFileName) {
        fileName = customFileName;
      } else {
        const now = new Date();
        const timestamp = now.getFullYear().toString().slice(2) +
                          String(now.getMonth() + 1).padStart(2, '0') +
                          String(now.getDate()).padStart(2, '0') + '_' +
                          String(now.getHours()).padStart(2, '0') +
                          String(now.getMinutes()).padStart(2, '0') +
                          String(now.getSeconds()).padStart(2, '0');
        fileName = `${timestamp}.png`;
      }
      finalPath = path.join(savePath, fileName);
      // Pass absolute path so the script saves to the right folder
      // regardless of the working directory used for execution
      cmd = cmd.replace("yymmdd_hhmmss.png", finalPath);
    }

    await new Promise((resolve, reject) => {
      // Use __dirname so relative scripts like "node mock-screenshot.js" resolve correctly
      exec(cmd, { cwd: __dirname }, (error, stdout, stderr) => {
        if (error) {
          writeToLog('error', `Screenshot command failed: ${cmd}`, error);
          return reject(error);
        }
        writeToLog('info', `Screenshot command success: ${cmd}`, stdout, stderr);
        resolve(stdout);
      });
    });
  }
  return finalPath;
});




// IPC: Run arbitrary shell command
ipcMain.handle("run-command", async (event, command) => {
  if (!command) return { success: false, error: 'No command' };
  return new Promise((resolve) => {
    exec(command, { cwd: __dirname, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, error: err.message, stdout: stdout || '', stderr: stderr || '' });
      } else {
        resolve({ success: true, stdout: stdout || '', stderr: stderr || '' });
      }
    });
  });
});

// IPC: Browse for utterance file
ipcMain.handle("browse-utterance-file", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select Utterance List File",
    properties: ["openFile"],
    filters: [
      { name: "Text Files", extensions: ["txt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

// IPC: Read text file
ipcMain.handle("read-text-file", async (event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    throw new Error(`Failed to read file: ${e.message}`);
  }
});

// IPC: Save export files with custom filename (Save As dialog)
ipcMain.handle("save-export", async (event, { htmlData, jsonChunks, baseName }) => {
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
  // Derive base name from saved HTML filename (strip _report.html suffix)
  const htmlBaseName = path.basename(htmlPath).replace(/_report\.html$/i, '');

  fs.writeFileSync(htmlPath, htmlData, "utf-8");

  // Save JSON data chunks alongside the HTML
  if (jsonChunks && jsonChunks.length > 0) {
    for (let i = 0; i < jsonChunks.length; i++) {
      const chunkFileName = `${htmlBaseName}_data_${String(i + 1).padStart(3, '0')}.json`;
      fs.writeFileSync(path.join(dir, chunkFileName), jsonChunks[i], "utf-8");
    }
  }

  return { htmlPath };
});

// IPC: Save table as TSV file
ipcMain.handle("save-tsv", async (event, { tsvData, defaultName }) => {
  const result = await dialog.showSaveDialog({
    title: "Save Table as TSV",
    defaultPath: defaultName || "table.tsv",
    filters: [
      { name: "TSV Files", extensions: ["tsv"] },
      { name: "Text Files", extensions: ["txt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled) return null;
  fs.writeFileSync(result.filePath, tsvData, "utf-8");
  return { filePath: result.filePath };
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

// IPC: Open detail HTML in external browser
ipcMain.handle("open-detail-html", async (event, html) => {
  try {
    const tempPath = path.join(app.getPath("temp"), `vila_detail_${Date.now()}.html`);
    fs.writeFileSync(tempPath, html, "utf8");
    await shell.openExternal(`file://${tempPath}`);
    return true;
  } catch (e) {
    console.error("Failed to open detail in browser:", e);
    return false;
  }
});

// IPC: Get screenshots from log file directory
// Build a sanitized utterance string for TC-style screenshot filename matching.
// Format: TC00001_수정된발화_숫자.png
// - Remove: spaces, backslashes, single/double quotes
// - Replace with '_': / : * ? < > |
function sanitizeUtteranceForFilename(utterance) {
  if (!utterance) return '';
  return utterance
    .replace(/[ \\'"\u005C]/g, '')
    .replace(/[/:*?<>|]/g, '_');
}

ipcMain.handle("get-screenshots", async (event, args) => {
  const logFilePath = typeof args === 'string' ? args : args.logFilePath;
  const utterance = typeof args === 'string' ? null : args.utterance;
  const utteranceIndex = typeof args === 'string' ? null : args.utteranceIndex;
  const screenshotDir = typeof args === 'object' ? args.screenshotDir : null;
  const conversationId = typeof args === 'object' ? args.conversationId : null;
  const requestId = typeof args === 'object' ? args.requestId : null;

  // Direct screenshotDir mode: search by conversationId + requestId prefix
  if (screenshotDir && (conversationId || requestId)) {
    writeToLog('info', `get-screenshots: Direct dir mode. Dir: ${screenshotDir}, convId: ${conversationId}, reqId: ${requestId}`);
    if (!fs.existsSync(screenshotDir)) return [];
    try {
      const files = fs.readdirSync(screenshotDir);
      const prefix = [conversationId, requestId].filter(Boolean).join('_');
      const matched = files.filter(f => f.toLowerCase().endsWith('.png') && f.startsWith(prefix))
        .sort((a, b) => a.localeCompare(b));
      return matched.map(f => ({ name: f, path: path.join(screenshotDir, f) }));
    } catch (e) {
      writeToLog('error', 'get-screenshots: Error reading direct screenshotDir.', e);
      return [];
    }
  }

  writeToLog('info', `get-screenshots: Searching for screenshots. Utterance: "${utterance}", Index: ${utteranceIndex}, LogPath: ${logFilePath}`);

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
    
    // Build TC-style prefix: TC00001_sanitizedUtterance
    let tcPrefix = null;
    if (utteranceIndex && utterance) {
      const padded = String(utteranceIndex).padStart(5, '0');
      const sanitized = sanitizeUtteranceForFilename(utterance);
      tcPrefix = `TC${padded}_${sanitized}`;
    }

    // Filter: TC00001_sanitizedUtterance_N.png (primary) or legacy 발화_ prefix (fallback)
    const utteranceFiles = files.filter(f => {
      if (!f.toLowerCase().endsWith(".png")) return false;
      if (tcPrefix && f.startsWith(tcPrefix)) return true;
      if (f.toLowerCase().startsWith("발화_")) return true;
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

// IPC: Find in page (Ctrl+F)
ipcMain.handle("find-in-page", (event, text, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !text) return;
  win.webContents.findInPage(text, options || {});
});
ipcMain.handle("stop-find-in-page", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.webContents.stopFindInPage('clearSelection');
});

// Auto-updater event listeners
let mainWindow;
let detailWindows = []; // Track open detail windows

// ── Multi-Instance Support (no single-instance lock) ──
app.whenReady().then(() => {
    writeToLog('info', `VILA App Started, Version: ${app.getVersion()}`);
    // Restore last preset (must be after app.ready so app.getPath works)
    currentConfigFile = loadSettings().lastPreset || CONFIG_NAME;
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

// Update mainWindow reference when new window is created
app.on("window-all-closed", () => {
  mainWindow = null;
  if (process.platform !== "darwin") app.quit();
});