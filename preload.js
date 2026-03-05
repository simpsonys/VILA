const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  loadConfig: () => ipcRenderer.invoke("load-config"),
  openConfigFolder: () => ipcRenderer.invoke("open-config-folder"),
  openAndReadFile: (filePath) => ipcRenderer.invoke("open-and-read-file", filePath),
  onFileContentLoaded: (callback) => ipcRenderer.on("file-content-loaded", (event, data) => callback(data)),
  onFileDataChunk: (callback) => ipcRenderer.on("file-data-chunk", (event, data) => callback(data)),
  onFileReadComplete: (callback) => ipcRenderer.on("file-read-complete", (event, data) => callback(data)),
  onFileReadError: (callback) => ipcRenderer.on("file-read-error", (event, data) => callback(data)),
  cancelFileRead: () => ipcRenderer.send("cancel-file-read"),
  saveExport: (data) => ipcRenderer.invoke("save-export", data),
  getAppVersion: () => ipcRenderer.invoke("get-version"),
  getScreenshots: (args) => ipcRenderer.invoke("get-screenshots", args),
  readScreenshot: (filePath) => ipcRenderer.invoke("read-screenshot", filePath),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  openDetailWindow: (data) => ipcRenderer.invoke("open-detail-window", data),
  onSetUtteranceData: (callback) => ipcRenderer.on("set-utterance-data", (event, data) => callback(data)),
  
  // Preset management
  listPresets: () => ipcRenderer.invoke("list-presets"),
  switchPreset: (fileName) => ipcRenderer.invoke("switch-preset", fileName),
  addCustomPreset: () => ipcRenderer.invoke("add-custom-preset"),
  
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