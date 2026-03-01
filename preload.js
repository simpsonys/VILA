const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  loadConfig: () => ipcRenderer.invoke("load-config"),
  openConfigFolder: () => ipcRenderer.invoke("open-config-folder"),
  openFileDialog: () => ipcRenderer.invoke("open-file-dialog"),
  readFileBuffer: (filePath) => ipcRenderer.invoke("read-file-buffer", filePath),
  saveExport: (data) => ipcRenderer.invoke("save-export", data),
  getAppVersion: () => ipcRenderer.invoke("get-version"),
});
