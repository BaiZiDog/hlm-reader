'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hlmDesktop', {
  getState: () => ipcRenderer.invoke('reader:get-state'),
  setZoom: (zoom) => ipcRenderer.send('reader:set-zoom', zoom),
  saveProgress: (progress) => ipcRenderer.send('reader:save-progress', progress),
  saveProgressSync: (progress) => ipcRenderer.sendSync('reader:save-progress-sync', progress),
  saveBook: (json) => ipcRenderer.invoke('reader:save-book', json),

  aiGetConfig: () => ipcRenderer.invoke('ai:get-config'),
  aiSaveConfig: (payload) => ipcRenderer.invoke('ai:save-config', payload),
  aiListModels: (overrides) => ipcRenderer.invoke('ai:list-models', overrides),
  aiSend: (payload) => ipcRenderer.invoke('ai:send', payload),
  aiAbort: () => ipcRenderer.send('ai:abort'),
  aiReset: () => ipcRenderer.invoke('ai:reset'),
  onAiEvent: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('ai:event', (_event, data) => callback(data));
  },
});
