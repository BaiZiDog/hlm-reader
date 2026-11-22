// 《红楼梦》桌面阅读器 —— Electron 主进程
'use strict';

const { app, BrowserWindow, Menu, ipcMain, screen, shell, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { registerAiIpc, resetOnLoad, resetBook } = require('./ai-main');
const { stopService } = require('./ofm-service');

app.setName('红楼梦阅读器');
app.setAppUserModelId('com.hlm.reader');

const STATE_FILE = path.join(app.getPath('userData'), 'reader-state.json');
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2.0;

let mainWindow = null;
let saveTimer = null;

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const saved = loadState();
const state = {
  window: saved.window && typeof saved.window === 'object' ? saved.window : {},
  zoom: clampZoom(saved.zoom),
  progress: saved.progress && typeof saved.progress === 'object' ? saved.progress : null,
};

function clampZoom(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(n * 100) / 100));
}

function saveStateNow() {
  saveTimer = null;
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error('保存阅读状态失败:', err);
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveStateNow, 200);
}

function captureWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const maximized = mainWindow.isMaximized();
  const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  state.window = { ...bounds, maximized };
  scheduleSave();
}

function initialBounds() {
  const b = state.window;
  const area = screen.getPrimaryDisplay().workArea;
  const maxWidth = Math.max(960, area.width - 40);
  const maxHeight = Math.max(640, area.height - 40);
  let width = Number.isFinite(b.width) ? Math.round(b.width) : 1360;
  let height = Number.isFinite(b.height) ? Math.round(b.height) : 880;
  width = Math.min(Math.max(960, width), maxWidth);
  height = Math.min(Math.max(640, height), maxHeight);
  let x = Number.isFinite(b.x) ? Math.round(b.x) : undefined;
  let y = Number.isFinite(b.y) ? Math.round(b.y) : undefined;
  if (x !== undefined && y !== undefined) {
    const visible = screen.getAllDisplays().some((display) => {
      const a = display.workArea;
      return x + width > a.x + 80 && x < a.x + a.width - 80 &&
             y + height > a.y + 40 && y < a.y + a.height - 40;
    });
    if (!visible) {
      x = undefined;
      y = undefined;
    }
  }
  return { x, y, width, height };
}

function createWindow() {
  const bounds = initialBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: '红楼梦 · 阅读器',
    icon: path.join(__dirname, 'app', 'icon.ico'),
    backgroundColor: '#f4ede0',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: process.argv.includes('--dev'),
    },
  });

  if (state.window.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});

  mainWindow.webContents.on('did-finish-load', () => {
    // 阅读器的缩放由页面内的 --read-size 控制，清除 Chromium 可能记住的整页缩放。
    mainWindow.webContents.setZoomFactor(1);
    resetOnLoad();
    runScreenshotIfRequested();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const template = [];
    if (params.selectionText && params.selectionText.trim()) {
      template.push({ label: '复制', role: 'copy' });
    }
    if (params.isEditable) {
      template.push(
        { label: '剪切', role: 'cut' },
        { label: '粘贴', role: 'paste' },
        { type: 'separator' },
        { label: '全选', role: 'selectAll' },
      );
    }
    if (template.length) Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  mainWindow.on('resize', captureWindowBounds);
  mainWindow.on('move', captureWindowBounds);
  mainWindow.on('close', () => {
    captureWindowBounds();
    saveStateNow();
  });
  mainWindow.on('closed', () => {
    resetOnLoad();
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
}

// ---- 截图模式：--screenshot=<路径> [--eval=<js>] ----
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runScreenshotIfRequested() {
  const shotArg = process.argv.find((arg) => arg.startsWith('--screenshot='));
  if (!shotArg) return;
  const shotPath = path.resolve(shotArg.slice('--screenshot='.length));
  const evalArg = process.argv.find((arg) => arg.startsWith('--eval='));
  try {
    await delay(1300);
    if (evalArg) {
      const code = evalArg.slice('--eval='.length);
      try {
        const result = await mainWindow.webContents.executeJavaScript(code, true);
        if (result !== undefined) console.log('eval:', result);
      } catch (err) {
        console.error('执行测试脚本失败:', err);
      }
      await delay(900);
    }
    const image = await mainWindow.webContents.capturePage();
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    fs.writeFileSync(shotPath, image.toPNG());
    console.log('screenshot:', shotPath);
  } catch (err) {
    console.error('截图失败:', err);
  } finally {
    app.exit(0);
  }
}

// ---- IPC ----
ipcMain.handle('reader:get-state', () => ({
  zoom: state.zoom,
  progress: state.progress,
}));

// 桌面版也允许从界面导入 book.json：写入用户数据目录，并清空 AI 的书页缓存。
ipcMain.handle('reader:copy-text', (_event, text) => {
  try {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || '复制失败。' };
  }
});

ipcMain.handle('reader:save-book', (_event, json) => {
  try {
    const text = String(json || '');
    if (text.length < 100 || text.length > 80 * 1024 * 1024) {
      return { ok: false, error: '书页数据大小异常。' };
    }
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.chapters) || !parsed.chapters.length) {
      return { ok: false, error: '书页数据缺少 chapters 数组。' };
    }
    const target = path.join(app.getPath('userData'), 'book.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf8');
    resetBook();
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: err.message || '保存书页数据失败。' };
  }
});

ipcMain.on('reader:set-zoom', (_event, value) => {
  // 缩放只作用于正文/注释字号，由渲染进程设置 CSS 变量；主进程仅负责持久化。
  state.zoom = clampZoom(value);
  scheduleSave();
});

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

ipcMain.on('reader:save-progress', (_event, progress) => {
  const normalized = normalizeProgress(progress);
  if (!normalized) return;
  state.progress = normalized;
  scheduleSave();
});

// 关闭窗口时由渲染进程同步提交，确保最后一次滚动位置落盘。
ipcMain.on('reader:save-progress-sync', (event, progress) => {
  const normalized = normalizeProgress(progress);
  if (normalized) {
    state.progress = normalized;
    saveStateNow();
  }
  event.returnValue = true;
});

// ---- 生命周期 ----
let quitting = false;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerAiIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    captureWindowBounds();
    saveStateNow();
    stopService().finally(() => app.quit());
  });
}
