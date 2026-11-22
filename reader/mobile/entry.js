'use strict';

/**
 * 移动端 / PWA 的桌面 API 桥。
 *
 * 把 ai-main.js（原本运行在 Electron 主进程）打包进浏览器，并实现
 * window.hlmDesktop 的同名接口。ai.js 与 app.js 不需要知道平台差异。
 *
 * 由 esbuild 打包为 app/mobile-ai.js；桌面版 preload 已注入
 * window.hlmDesktop 时本文件不做任何事。
 */
(() => {
  if (window.hlmDesktop) return;

  window.__HLM_MOBILE__ = true;

  const KEY_STORAGE = 'hlm.ai.key.v1';
  const STATE_STORAGE = 'hlm.reader.state.v1';
  const keyStore = {
    get() {
      try {
        return localStorage.getItem(KEY_STORAGE) || '';
      } catch {
        return '';
      }
    },
    set(value) {
      try {
        localStorage.setItem(KEY_STORAGE, String(value));
      } catch {
        /* 隐私模式等情况下只保留在内存里 */
      }
    },
    remove() {
      try {
        localStorage.removeItem(KEY_STORAGE);
      } catch {
        /* ignore */
      }
    },
  };
  window.__HLM_MOBILE_KEY_STORE__ = keyStore;

  const { app, ipcMain } = require('electron');
  const { readFileSync, writeFileSync, mkdirSync } = require('fs');
  // 只为确认 shim 被 esbuild 注入；实际由 ai-main 间接调用。
  void app;
  void readFileSync;
  void writeFileSync;
  void mkdirSync;

  const ai = require('../ai-main');
  ai.registerAiIpc();

  const eventHandlers = new Set();
  function emit(payload) {
    for (const handler of eventHandlers) {
      try {
        handler(payload);
      } catch (err) {
        console.error('AI 事件处理器失败:', err);
      }
    }
  }

  function fakeSender() {
    return {
      isDestroyed() {
        return false;
      },
      send(channel, payload) {
        if (channel === 'ai:event') emit(payload);
      },
    };
  }

  const event = { sender: fakeSender() };

  // ---------- 阅读状态（localStorage） ----------
  let stateCache = null;
  let saveTimer = 0;
  function readState() {
    if (stateCache) return stateCache;
    try {
      const raw = JSON.parse(localStorage.getItem(STATE_STORAGE) || '{}');
      stateCache = raw && typeof raw === 'object' ? raw : {};
    } catch {
      stateCache = {};
    }
    return stateCache;
  }
  function saveStateSoon() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      try {
        localStorage.setItem(STATE_STORAGE, JSON.stringify(readState()));
      } catch {
        /* ignore */
      }
    }, 180);
  }
  function saveStateNow() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = 0;
    }
    try {
      localStorage.setItem(STATE_STORAGE, JSON.stringify(readState()));
    } catch {
      /* ignore */
    }
  }

  function normalizeProgress(progress) {
    if (!progress || typeof progress !== 'object') return null;
    const chapter = Number(progress.chapter);
    if (!Number.isInteger(chapter) || chapter < 0 || chapter > 1000) return null;
    return {
      chapter,
      scrollTop: Math.max(0, Number(progress.scrollTop) || 0),
      ratio: Math.min(1, Math.max(0, Number(progress.ratio) || 0)),
      updatedAt: new Date().toISOString(),
    };
  }

  window.hlmDesktop = {
    getState: async () => {
      const state = readState();
      return {
        zoom: Number(state.zoom) || 1,
        progress: state.progress || null,
      };
    },
    setZoom: (zoom) => {
      const value = Number(zoom);
      if (Number.isFinite(value)) readState().zoom = value;
      saveStateSoon();
    },
    saveProgress: (progress) => {
      const normalized = normalizeProgress(progress);
      if (!normalized) return;
      readState().progress = normalized;
      saveStateSoon();
    },
    saveProgressSync: (progress) => {
      const normalized = normalizeProgress(progress);
      if (normalized) readState().progress = normalized;
      saveStateNow();
      return true;
    },

    aiGetConfig: () => ipcMain.invoke('ai:get-config', event),
    aiSaveConfig: (payload) => ipcMain.invoke('ai:save-config', event, payload),
    aiListModels: (overrides) => ipcMain.invoke('ai:list-models', event, overrides),
    aiSend: (payload) => ipcMain.invoke('ai:send', event, payload),
    aiAbort: () => ipcMain.send('ai:abort'),
    aiReset: () => ipcMain.invoke('ai:reset', event),
    onAiEvent: (callback) => {
      if (typeof callback === 'function') eventHandlers.add(callback);
    },
  };

  window.addEventListener('pagehide', saveStateNow);
})();
