'use strict';

/** 浏览器端 electron 模块替身：只提供 ai-main.js 需要的 app / ipcMain / safeStorage。 */

const handlers = new Map();
const listeners = new Map();

const app = {
  getPath() {
    return '/userdata';
  },
  getName() {
    return 'hlm-reader';
  },
};

const ipcMain = {
  handle(channel, fn) {
    handlers.set(channel, fn);
  },
  on(channel, fn) {
    listeners.set(channel, fn);
  },
  invoke(channel, event, ...args) {
    const fn = handlers.get(channel);
    if (typeof fn !== 'function') {
      return Promise.reject(new Error(`没有注册 IPC：${channel}`));
    }
    try {
      return Promise.resolve(fn(event, ...args));
    } catch (err) {
      return Promise.reject(err);
    }
  },
  send(channel, ...args) {
    const fn = listeners.get(channel);
    if (typeof fn === 'function') fn({}, ...args);
  },
};

// 浏览器没有 DPAPI。ai-main 会通过 __HLM_MOBILE_KEY_STORE__ 保存密钥；
// 这里的 safeStorage 故意报告不可用，避免假装提供系统级加密。
const safeStorage = {
  isEncryptionAvailable() {
    return false;
  },
  encryptString() {
    throw new Error('浏览器不支持 safeStorage。');
  },
  decryptString() {
    throw new Error('浏览器不支持 safeStorage。');
  },
};

module.exports = { app, ipcMain, safeStorage, handlers, listeners };
