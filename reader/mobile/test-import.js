// 开发期测试：无 data.js 时显示导入页，并通过 file input 导入 book.json。
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'tmp-mobile-nodata');
const SHOTS = path.join(ROOT, 'shots-mobile');
const PORT = 8900 + Math.floor(Math.random() * 100);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const value = await win.webContents.executeJavaScript(expression, true);
      if (value) return value;
    } catch (err) {
      console.error('waitFor:', err.message);
    }
    await sleep(250);
  }
  throw new Error(`等待超时: ${expression}`);
}

async function shot(win, name) {
  const image = await win.webContents.capturePage();
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  console.log('screenshot:', file);
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      let file = path.join(WEB, decodeURIComponent(url.pathname));
      if (url.pathname === '/' || url.pathname === '') file = path.join(WEB, 'index.html');
      if (!file.startsWith(WEB)) {
        res.writeHead(403).end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

app.whenReady().then(async () => {
  const server = await serve();
  const win = new BrowserWindow({
    width: 390,
    height: 844,
    show: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.log('console:', level, message);
  });
  try {
    await win.webContents.session.clearStorageData({
      storages: ['indexeddb', 'localstorage', 'serviceworkers', 'cachestorage'],
    });
    await win.loadURL(`http://127.0.0.1:${PORT}/index.html`);
    await waitFor(win, "!document.querySelector('#data-import').hidden");
    console.log('import screen:', await win.webContents.executeJavaScript(
      "document.querySelector('.data-import-card h1').textContent", true));
    await shot(win, '06-import');

    const imported = await win.webContents.executeJavaScript(`(async () => {
      const text = await (await fetch('book.json')).text();
      const file = new File([text], 'book.json', { type: 'application/json' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('#data-import-file');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`, true);
    console.log('file dispatch:', imported);
    await sleep(900);
    console.log('status:', await win.webContents.executeJavaScript(
      "document.querySelector('#data-import-status').textContent", true));
    await waitFor(win, 'Boolean(window.HLM_READER && window.HLM_READER.data && window.HLM_READER.data.chapters)', 30000);
    await sleep(800);
    console.log('after import:', await win.webContents.executeJavaScript(`(async () => JSON.stringify({
      book: window.HLM_READER.data.chapters.length,
      importHidden: document.querySelector('#data-import').hidden,
      sw: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller),
      stored: (await new Promise((resolve) => {
        const req = indexedDB.open('hlm-reader', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('book', 'readonly');
          const get = tx.objectStore('book').get('current');
          get.onsuccess = () => resolve(Boolean(get.result));
          get.onerror = () => resolve(false);
        };
        req.onerror = () => resolve(false);
      })),
    }))()`, true));
    await shot(win, '07-imported');
    await sleep(700);
    console.log('sw controller:', await win.webContents.executeJavaScript(
      "Boolean(navigator.serviceWorker && navigator.serviceWorker.controller)", true));

    // 停掉静态服务器后刷新，验证 Service Worker 能离线启动，书源来自 IndexedDB。
    await new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
    await sleep(300);
    await win.webContents.reload();
    await waitFor(win, 'Boolean(window.HLM_READER && window.HLM_READER.data && window.HLM_READER.data.chapters)', 30000);
    await sleep(800);
    console.log('offline:', await win.webContents.executeJavaScript(`JSON.stringify({
      book: window.HLM_READER.data.chapters.length,
      importHidden: document.querySelector('#data-import').hidden,
      boot: Boolean(document.querySelector('#boot')),
      sw: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller),
    })`, true));
    await shot(win, '10-offline');
    console.log('done');
  } catch (err) {
    console.error('TEST FAILED:', err.stack || err);
    try {
      console.log('diagnostics:', await win.webContents.executeJavaScript(`JSON.stringify({
        url: location.href,
        body: document.body.innerText.slice(0, 300),
        hasData: Boolean(window.HLM_DATA),
        hasSource: Boolean(window.HLM_DATA_SOURCE),
        importHidden: document.querySelector('#data-import') && document.querySelector('#data-import').hidden,
        boot: Boolean(document.querySelector('#boot')),
        sw: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller),
        swRegs: navigator.serviceWorker ? 'yes' : 'no',
        scripts: Array.from(document.scripts).map((s) => s.src.split('/').pop()),
      })`, true));
    } catch (diagErr) {
      console.error('diagnostics failed:', diagErr.message);
    }
  } finally {
    win.destroy();
    server.close();
    app.exit(0);
  }
});
