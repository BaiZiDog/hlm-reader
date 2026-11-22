/* 书页数据导入：把 book.json / data.js 存进 IndexedDB，供网页版与安卓版启动。 */
'use strict';

(() => {
  const DB_NAME = 'hlm-reader';
  const DB_VERSION = 1;
  const STORE = 'book';
  const KEY = 'current';
  const FALLBACK_KEY = 'hlm.book.json';

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('此浏览器不支持 IndexedDB。'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开本地数据库。'));
    });
    return dbPromise;
  }

  async function readStored() {
    try {
      const db = await openDb();
      const value = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (value) return value;
    } catch (err) {
      console.warn('读取 IndexedDB 书源失败:', err);
    }
    try {
      const raw = localStorage.getItem(FALLBACK_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return null;
  }

  async function writeStored(book) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(book, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('写入本地数据库失败。'));
      tx.onabort = () => reject(tx.error || new Error('写入本地数据库被中止。'));
    });
    // 桌面版 AI 在主进程读 book.json；浏览器/安卓版由 mobile-ai 的 fs shim 读内存。
    if (window.hlmDesktop && typeof window.hlmDesktop.saveBook === 'function') {
      try {
        const result = await window.hlmDesktop.saveBook(JSON.stringify(book));
        if (result && result.ok === false) {
          console.warn('桌面 AI 书页保存失败:', result.error);
        }
      } catch (err) {
        console.warn('桌面 AI 书页保存失败:', err);
      }
    }
    try {
      localStorage.removeItem(FALLBACK_KEY);
    } catch {
      /* ignore */
    }
  }

  function validateBook(value) {
    if (!value || typeof value !== 'object') throw new Error('文件不是有效的书页数据。');
    if (!Array.isArray(value.chapters) || !value.chapters.length) {
      throw new Error('书页数据缺少 chapters 数组。');
    }
    if (value.chapters.length > 500) throw new Error('章节数量异常，已拒绝导入。');
    if (!value.meta || typeof value.meta !== 'object') value.meta = {};
    if (!Number.isInteger(value.meta.hui)) value.meta.hui = value.chapters.length;
    if (!Number.isInteger(value.meta.chapters)) value.meta.chapters = value.chapters.length;
    value.chapters.forEach((chapter, index) => {
      if (!chapter || typeof chapter !== 'object') throw new Error('章节数据格式不正确。');
      if (!Array.isArray(chapter.paragraphs) || !chapter.paragraphs.length) {
        throw new Error(`章节「${chapter.label || chapter.id || '未知'}」没有正文段落。`);
      }
      if (!chapter.id) chapter.id = String(index + 1).padStart(3, '0');
      if (!chapter.label) chapter.label = `第${index + 1}回`;
      if (!chapter.title) chapter.title = '';
      if (!chapter.notes || typeof chapter.notes !== 'object') chapter.notes = {};
      if (!Array.isArray(chapter.noteOrder)) chapter.noteOrder = Object.keys(chapter.notes);
      if (!Number.isInteger(chapter.noteCount)) chapter.noteCount = chapter.noteOrder.length;
      if (!Number.isInteger(chapter.linkCount)) chapter.linkCount = 0;
    });
    return value;
  }

  function parsePayload(text) {
    let raw = String(text || '').replace(/^﻿/, '').trim();
    if (!raw) throw new Error('文件是空的。');
    if (raw.startsWith('window.HLM_DATA')) {
      raw = raw.replace(/^window\.HLM_DATA\s*=\s*/, '').replace(/;\s*$/, '');
    }
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('无法解析 JSON；请选择由构建脚本生成的 book.json 或 data.js。');
    }
    return validateBook(value);
  }

  let uiReady = false;
  const els = {};

  function cacheEls() {
    if (uiReady) return;
    els.panel = document.getElementById('data-import');
    els.pick = document.getElementById('data-import-pick');
    els.file = document.getElementById('data-import-file');
    els.status = document.getElementById('data-import-status');
    if (els.file) els.file.addEventListener('change', () => {
      const file = els.file.files && els.file.files[0];
      if (file) importFile(file);
      els.file.value = '';
    });
    if (els.pick) {
      els.pick.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          els.file?.click();
        }
      });
    }
    if (els.panel) {
      els.panel.addEventListener('dragover', (event) => {
        event.preventDefault();
        els.panel.classList.add('dragging');
      });
      els.panel.addEventListener('dragleave', () => els.panel.classList.remove('dragging'));
      els.panel.addEventListener('drop', (event) => {
        event.preventDefault();
        els.panel.classList.remove('dragging');
        const file = event.dataTransfer?.files?.[0];
        if (file) importFile(file);
      });
    }
    uiReady = true;
  }

  function setStatus(text, kind) {
    cacheEls();
    if (!els.status) return;
    els.status.textContent = text || '';
    els.status.className = `data-import-status${kind ? ` ${kind}` : ''}`;
  }

  async function importFile(file) {
    cacheEls();
    if (file.size > 80 * 1024 * 1024) {
      setStatus('文件超过 80 MB，已拒绝导入。', 'error');
      return;
    }
    setStatus(`正在读取 ${file.name}（${(file.size / 1024 / 1024).toFixed(1)} MB）…`);
    try {
      const text = await file.text();
      const book = parsePayload(text);
      setStatus(`正在保存 ${book.chapters.length} 篇书页…`);
      await writeStored(book);
      setStatus(`已导入 ${book.chapters.length} 篇，正在打开…`, 'ok');
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      console.error('导入书源失败:', err);
      setStatus(err.message || '导入失败。', 'error');
    }
  }

  function showImport(message) {
    cacheEls();
    if (els.panel) els.panel.hidden = false;
    const boot = document.getElementById('boot');
    if (boot) boot.remove();
    if (message) setStatus(message, 'error');
    setTimeout(() => els.pick?.focus(), 50);
  }

  async function loadBook() {
    const book = await readStored();
    if (!book) return null;
    try {
      return validateBook(book);
    } catch (err) {
      console.warn('本地书源损坏:', err);
      return null;
    }
  }

  async function clearBook() {
    try {
      const db = await openDb();
      await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(KEY);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(FALLBACK_KEY);
    } catch {
      /* ignore */
    }
  }

  window.HLM_DATA_SOURCE = {
    load: loadBook,
    save: async (book) => writeStored(validateBook(book)),
    clear: clearBook,
    showImport,
    parse: parsePayload,
  };
})();
