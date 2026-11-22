'use strict';

/**
 * 浏览器端的最小 fs 替代：只覆盖 ai-main.js 需要的几个调用。
 * - app/book.json 来自启动时载入的 window.HLM_BOOK
 * - ai-settings.json 存在 localStorage
 * - 背景信息.md 可选，不存在时按 ENOENT 处理
 */

const SETTINGS_KEY = 'hlm.ai.settings.v1';
const DEFAULT_SETTINGS = JSON.stringify({
  provider: 'custom',
  baseURL: 'https://api.anthropic.com',
  model: '',
  models: [],
  spoiler: false,
  keyEnc: '',
});

function slash(p) {
  return String(p).replace(/\\/g, '/');
}

function readFileSync(file, _encoding) {
  const p = slash(file);
  if (p.endsWith('/app/book.json') || p === 'app/book.json' || p.endsWith('/userdata/book.json')) {
    if (!window.HLM_BOOK || !Array.isArray(window.HLM_BOOK.chapters)) {
      throw new Error('书页数据尚未载入。');
    }
    return JSON.stringify(window.HLM_BOOK);
  }
  if (p.endsWith('/ai-settings.json') || p === 'ai-settings.json') {
    return localStorage.getItem(SETTINGS_KEY) || DEFAULT_SETTINGS;
  }
  if (p.endsWith('背景信息.md')) {
    const hidden = window.HLM_BACKGROUND;
    if (typeof hidden === 'string' && hidden.trim()) return hidden;
    throw new Error('ENOENT');
  }
  throw new Error(`ENOENT: ${p}`);
}

function writeFileSync(file, data, _encoding) {
  const p = slash(file);
  if (p.endsWith('/ai-settings.json') || p === 'ai-settings.json') {
    localStorage.setItem(SETTINGS_KEY, String(data));
    return;
  }
  throw new Error(`EROFS: ${p}`);
}

function mkdirSync() {
  /* localStorage 不需要建目录 */
}

function existsSync(file) {
  const p = slash(file);
  if (p.endsWith('/book.json')) {
    return Boolean(window.HLM_BOOK && Array.isArray(window.HLM_BOOK.chapters));
  }
  if (p.endsWith('背景信息.md')) {
    return typeof window.HLM_BACKGROUND === 'string' && Boolean(window.HLM_BACKGROUND.trim());
  }
  return false;
}

module.exports = {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  SETTINGS_KEY,
};
