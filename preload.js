const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  loadConfig: () => ipcRenderer.invoke("load-config"),
  listPresets: () => ipcRenderer.invoke('list-presets'), // New
  loadSpecificConfig: (fileName) => ipcRenderer.invoke('load-specific-config', fileName), // New
  openConfigFolder: () => ipcRenderer.invoke("open-config-folder"),
  openFileDialog: () => ipcRenderer.invoke("open-file-dialog"),
  readFileBuffer: (filePath) => ipcRenderer.invoke("read-file-buffer", filePath),
  saveExport: (data) => ipcRenderer.invoke("save-export", data),
  getAppVersion: () => ipcRenderer.invoke("get-version"),
  getScreenshots: (logFilePath) => ipcRenderer.invoke("get-screenshots", logFilePath),
  readScreenshot: (filePath) => ipcRenderer.invoke("read-screenshot", filePath),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  openDetailWindow: (data) => ipcRenderer.invoke("open-detail-window", data),
  onSetUtteranceData: (callback) => ipcRenderer.on("set-utterance-data", (event, data) => callback(data)),
  
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
