/**
 * tauri-ipc.js
 * Bridges existing Electron window.electronAPI calls to Tauri v2 APIs.
 */

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { open: openDialog } = window.__TAURI__.dialog;

const listeners = {};

// Log wrapping to trace execution
function logStep(step, data = '') {
  console.log(`[Tauri IPC] ${step}`, data);
}

// Setup Global Tauri Event Listeners
listen('file-data-chunk', (event) => {
  if (listeners['onFileDataChunk']) listeners['onFileDataChunk']({ text: event.payload, byteLength: event.payload.length });
});
listen('file-read-complete', () => {
  logStep('File read complete emitted');
  if (listeners['onFileReadComplete']) listeners['onFileReadComplete']();
});
listen('file-read-error', (event) => {
  logStep('File read error', event.payload);
  if (listeners['onFileReadError']) listeners['onFileReadError'](event.payload);
});
listen('log-stream-data', (event) => {
  if (listeners['onLogStreamData']) listeners['onLogStreamData']({ text: event.payload, byteLength: event.payload.length });
});
listen('log-stream-error', (event) => {
  if (listeners['onLogStreamError']) listeners['onLogStreamError'](event.payload);
});
listen('log-stream-closed', (event) => {
  if (listeners['onLogStreamClosed']) listeners['onLogStreamClosed'](event.payload);
});

// Fix Drag & Drop event
listen('tauri://drag-drop', async (event) => {
  logStep('tauri://drag-drop event triggered', event.payload);
  const paths = event.payload.paths || (Array.isArray(event.payload) ? event.payload : []);
  if (paths && paths.length > 0) {
    const droppedPath = paths[0];
    logStep('File dropped', droppedPath);
    if (window.electronAPI && window.electronAPI.openAndReadFile) {
      await window.electronAPI.openAndReadFile(droppedPath);
    }
  }
});

window.electronAPI = {
  getAppVersion: async () => {
    logStep('getAppVersion called');
    return await invoke('get_app_version');
  },
  
  logMessage: async ({ level, message, args }) => {
    console.log(`[App Log] ${level}: ${message}`, args || '');
  },
  
  listPresets: async () => {
    logStep('listPresets called');
    return await invoke('list_presets');
  },
  
  loadConfig: async () => {
    logStep('loadConfig called');
    return await invoke('load_config');
  },
  
  switchPreset: async (fileName) => {
    logStep('switchPreset called', fileName);
    return await invoke('switch_preset', { fileName });
  },
  
  addCustomPreset: async () => {
    logStep('addCustomPreset called');
    try {
      const selected = await openDialog({ filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (selected) {
        logStep('Selected preset file', selected);
        return await invoke('add_custom_preset_file', { filePath: selected });
      }
    } catch (e) {
      console.error(e);
    }
    return { success: false, reason: 'Canceled' };
  },

  openConfigFolder: async () => {
    logStep('openConfigFolder called');
    await invoke('open_config_folder');
  },

  openAndReadFile: async (filePath = null) => {
    logStep('openAndReadFile called', filePath);
    try {
      let selectedPath = filePath;
      if (!selectedPath) {
        selectedPath = await openDialog({
          multiple: false,
          filters: [{ name: 'Log', extensions: ['log', 'txt', '*'] }]
        });
        logStep('File dialog returned', selectedPath);
      }
      if (selectedPath) {
        const fileName = selectedPath.split(/[/\\]/).pop();
        if (listeners['onFileContentLoaded']) {
          listeners['onFileContentLoaded']({
            success: true,
            filePath: selectedPath,
            fileName: fileName,
            encoding: 'utf-8',
            isStreaming: true,
            fileSize: 0
          });
        }
        await invoke('read_file_stream', { filePath: selectedPath });
        return { success: true, filePath: selectedPath };
      }
      return { success: false, reason: 'Canceled' };
    } catch (e) {
      console.error(e);
      return { success: false, reason: e.toString() };
    }
  },

  cancelFileRead: async () => {
    logStep('cancelFileRead called');
    await invoke('cancel_file_read');
  },
  
  openExternal: async (url) => {
    logStep('openExternal called', url);
    await invoke('open_external', { url });
  },
  
  toggleDevTools: async () => {
    logStep('toggleDevTools called');
    await invoke('toggle_dev_tools');
  },

  onFileContentLoaded: (cb) => { listeners['onFileContentLoaded'] = cb; },
  onFileDataChunk: (cb) => { listeners['onFileDataChunk'] = cb; },
  onFileReadComplete: (cb) => { listeners['onFileReadComplete'] = cb; },
  onFileReadError: (cb) => { listeners['onFileReadError'] = cb; },
  onLogStreamData: (cb) => { listeners['onLogStreamData'] = cb; },
  onLogStreamError: (cb) => { listeners['onLogStreamError'] = cb; },
  onLogStreamClosed: (cb) => { listeners['onLogStreamClosed'] = cb; },
  onSetUtteranceData: (cb) => { listeners['onSetUtteranceData'] = cb; },
  
  onUpdateAvailable: () => {},
  onUpdateNotAvailable: () => {},
  onDownloadProgress: () => {},
  onUpdateDownloaded: () => {},
  onUpdateError: () => {},

  startLogStream: async (cmd) => {
    logStep('startLogStream called', cmd);
    await invoke('start_log_stream', { commandStr: cmd });
  },
  
  stopLogStream: async () => {
    logStep('stopLogStream called');
    await invoke('stop_log_stream');
  },
  
  selectScreenshotFolder: async () => {
    logStep('selectScreenshotFolder called');
    return await openDialog({ directory: true });
  },
  
  runScreenshotCommand: async ({ command, savePath }) => {
    logStep('runScreenshotCommand called', { command, savePath });
    return await invoke('run_screenshot_command', { command, savePath });
  },
  
  readScreenshot: async (path) => {
    logStep('readScreenshot called', path);
    return await invoke('read_screenshot', { path });
  },
  
  openDetailHtml: async (html) => {
    logStep('openDetailHtml called (len: ' + html.length + ')');
    await invoke('open_detail_html', { html });
  },
  
  getScreenshots: async (args) => {
    logStep('getScreenshots called', args);
    const utterance = args && args.utterance ? args.utterance : null;
    const logFilePath = args && args.logFilePath ? args.logFilePath : null;
    return await invoke('get_screenshots', { logFilePath, utterance });
  },
  
  saveExport: async (args) => {
    logStep('saveExport called', args.baseName);
    await invoke('save_export', args);
  },
  
  openLogFile: async () => {
    logStep('openLogFile called');
    await invoke('open_log_file');
  }
};
