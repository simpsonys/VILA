const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  loadConfig: () => ipcRenderer.invoke("load-config"),
  openConfigFolder: () => ipcRenderer.invoke("open-config-folder"),
  openAndReadFile: (filePath) => ipcRenderer.invoke("open-and-read-file", filePath),
  onFileContentLoaded: (callback) => ipcRenderer.on("file-content-loaded", (event, data) => callback(data)),
  onFileDataChunk: (callback) => ipcRenderer.on("file-data-chunk", (event, data) => callback(data)),
  onFileReadComplete: (callback) => ipcRenderer.on("file-read-complete", (event, data) => callback(data)),
  onFileReadError: (callback) => ipcRenderer.on("file-read-error", (event, data) => callback(data)),
  cancelFileRead: () => ipcRenderer.send("cancel-file-read"),

  // Real-time log stream
  startLogStream: (command) => ipcRenderer.send("start-log-stream", command),
  stopLogStream: () => ipcRenderer.send("stop-log-stream"),
  onLogStreamData: (callback) => ipcRenderer.on("log-stream-data", (event, data) => callback(data)),
  onLogStreamError: (callback) => ipcRenderer.on("log-stream-error", (event, data) => callback(data)),
  onLogStreamClosed: (callback) => ipcRenderer.on("log-stream-closed", (event, code) => callback(code)),

  // Get OS file path for a File object (contextIsolation-safe replacement for file.path)
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // Screenshot
  selectScreenshotFolder: () => ipcRenderer.invoke("select-screenshot-folder"),
  runScreenshotCommand: (args) => ipcRenderer.invoke("run-screenshot-command", args),
  initScreenshotFolder: () => ipcRenderer.invoke("init-screenshot-folder"),
  copyScreenshotToClipboard: (filePath) => ipcRenderer.invoke("copy-screenshot-to-clipboard", filePath),
  saveScreenshotAs: (filePath) => ipcRenderer.invoke("save-screenshot-as", filePath),
  revealScreenshotInExplorer: (filePath) => ipcRenderer.invoke("reveal-screenshot-in-explorer", filePath),



  saveExport: (data) => ipcRenderer.invoke("save-export", data),
  saveTsv: (data) => ipcRenderer.invoke("save-tsv", data),
  getAppVersion: () => ipcRenderer.invoke("get-version"),
  getScreenshots: (args) => ipcRenderer.invoke("get-screenshots", args),
  readScreenshot: (filePath) => ipcRenderer.invoke("read-screenshot", filePath),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  openDetailWindow: (data) => ipcRenderer.invoke("open-detail-window", data),
  onSetUtteranceData: (callback) => ipcRenderer.on("set-utterance-data", (event, data) => callback(data)),
  
  // SDB Connect
  sdbConnect: (ip) => ipcRenderer.invoke("sdb-connect", ip),

  // Find in page (Ctrl+F)
  findInPage: (text, options) => ipcRenderer.invoke("find-in-page", text, options),
  stopFindInPage: () => ipcRenderer.invoke("stop-find-in-page"),
  onFoundInPage: (callback) => ipcRenderer.on("found-in-page", (event, result) => callback(result)),

  // Preset management
  listPresets: () => ipcRenderer.invoke("list-presets"),
  switchPreset: (fileName) => ipcRenderer.invoke("switch-preset", fileName),
  addCustomPreset: () => ipcRenderer.invoke("add-custom-preset"),
  deletePreset: (fileName) => ipcRenderer.invoke("delete-preset", fileName),
  resetPreset: (fileName) => ipcRenderer.invoke("reset-preset", fileName),
  
  // Logging
  logMessage: (log) => ipcRenderer.send("log-message", log),
  openLogFile: () => ipcRenderer.invoke("open-log-file"),
  toggleDevTools: () => ipcRenderer.invoke("toggle-devtools"),
  openInBrowser: (text) => ipcRenderer.invoke("open-in-browser", text),
  openDetailHtml: (html) => ipcRenderer.invoke("open-detail-html", html),

  // Auto-update methods
  checkUpdates: () => ipcRenderer.invoke("check-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  
  // Auto-update event listeners
  onUpdateAvailable: (callback) => ipcRenderer.on("update-available", (event, info) => callback(info)),
  onUpdateNotAvailable: (callback) => ipcRenderer.on("update-not-available", (event, info) => callback(info)),
  onDownloadProgress: (callback) => ipcRenderer.on("download-progress", (event, progress) => callback(progress)),
  onUpdateDownloaded: (callback) => ipcRenderer.on("update-downloaded", (event, info) => callback(info)),
  onUpdateError: (callback) => ipcRenderer.on("update-error", (event, error) => callback(error)),
});