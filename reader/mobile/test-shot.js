// 开发期移动端布局冒烟测试：用 Electron 以手机尺寸加载本地页面（不带 preload）。
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'app', 'index.html');
const SHOTS = path.join(ROOT, 'shots-mobile');
const WIDTH = Number(process.env.MW) || 390;
const HEIGHT = Number(process.env.MH) || 844;
const TAG = process.env.MTAG || 'phone';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const value = await win.webContents.executeJavaScript(expression, true);
      if (value) return value;
    } catch (err) {
      console.error('waitFor:', err.message);
    }
    await sleep(200);
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

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: true,
    backgroundColor: '#f5efe3',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.log('console:', level, message);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('renderer gone:', details);
  });
  try {
    await win.loadFile(INDEX);
    await waitFor(win, 'Boolean(window.HLM_READER && window.HLM_READER.data && window.HLM_READER.data.chapters)');
    await sleep(2000);
    const info = await win.webContents.executeJavaScript(`(() => ({
      mobile: window.__HLM_MOBILE__,
      desktopBridge: Boolean(window.hlmDesktop),
      book: window.HLM_READER.data.chapters.length,
      current: window.HLM_READER.getCurrentChapter().label,
      bodyClass: document.body.className,
      inner: [innerWidth, innerHeight],
      topbar: (() => { const r = document.querySelector('#topbar').getBoundingClientRect(); return [r.width, r.height]; })(),
      reader: (() => { const r = document.querySelector('#reader').getBoundingClientRect(); return [r.width, r.height]; })(),
      tocDisplay: getComputedStyle(document.querySelector('#toc')).display,
      scrimHidden: document.querySelector('#drawer-scrim').hidden,
      boot: Boolean(document.querySelector('#boot')),
      toc: (() => { const e=document.querySelector('#toc'); const r=e.getBoundingClientRect(); const c=getComputedStyle(e); return {rect:[r.x,r.y,r.width,r.height], transform:c.transform, left:c.left, width:c.width, paddingLeft:c.paddingLeft, overflow:c.overflow}; })(),
      item: (() => { const e=document.querySelector('.toc-item'); const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; })(),
      notes: (() => { const e=document.querySelector('#notes'); const r=e.getBoundingClientRect(); const c=getComputedStyle(e); return {rect:[r.x,r.y,r.width,r.height], transform:c.transform, z:c.zIndex}; })(),
    }))()`, true);
    console.log('info:', JSON.stringify(info));
    await shot(win, `${TAG}-01-reading`);

    await win.webContents.executeJavaScript("document.querySelector('#toggle-toc').click()", true);
    await sleep(700);
    await shot(win, `${TAG}-02-toc`);
    console.log('toc:', await win.webContents.executeJavaScript(`JSON.stringify({body:document.body.className, tocOpen:document.body.classList.contains('toc-mobile-open'), scrim:!document.querySelector('#drawer-scrim').hidden, rect:(()=>{const r=document.querySelector('#toc').getBoundingClientRect();return [r.x,r.width]})(), scrollLeft:document.querySelector('#toc').scrollLeft, listScroll:document.querySelector('.toc-list').scrollLeft, docScroll:document.documentElement.scrollLeft, head:(()=>{const r=document.querySelector('#toc .panel-head').getBoundingClientRect();return [r.x,r.width]})(), title:(()=>{const r=document.querySelector('#toc .panel-title').getBoundingClientRect();return [r.x,r.width]})(), filter:(()=>{const r=document.querySelector('#toc .toc-filter-wrap').getBoundingClientRect();return [r.x,r.width]})(), item:(()=>{const r=document.querySelector('.toc-item').getBoundingClientRect();return [r.x,r.width]})()})`, true));

    await win.webContents.executeJavaScript("document.querySelector('#drawer-scrim').click()", true);
    await win.webContents.executeJavaScript("document.querySelector('#toggle-notes').click()", true);
    await sleep(700);
    await shot(win, `${TAG}-03-notes`);
    console.log('notes:', await win.webContents.executeJavaScript(`JSON.stringify({body:document.body.className, notesOpen:document.body.classList.contains('notes-mobile-open'), tocOpen:document.body.classList.contains('toc-mobile-open'), scrim:!document.querySelector('#drawer-scrim').hidden, tocRect:(()=>{const r=document.querySelector('#toc').getBoundingClientRect();return [r.x,r.width]})(), notesRect:(()=>{const r=document.querySelector('#notes').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()})`, true));

    await win.webContents.executeJavaScript("document.querySelector('#drawer-scrim').click()", true);
    await win.webContents.executeJavaScript("document.querySelector('#ai-open').click()", true);
    await sleep(700);
    await shot(win, `${TAG}-04-ai`);
    console.log('ai:', await win.webContents.executeJavaScript(`JSON.stringify({
      open: !document.querySelector('#ai-float').hidden,
      rect: (() => { const r = document.querySelector('#ai-float').getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; })(),
      builtinHidden: (() => { const b=document.querySelector('.ai-presets [data-provider="builtin"]'); return b && b.hidden; })(),
    })`, true));

    await win.webContents.executeJavaScript("document.querySelector('#ai-settings-open').click()", true);
    await sleep(300);
    await shot(win, `${TAG}-05-ai-settings`);

    await win.webContents.executeJavaScript("document.querySelector('#ai-close').click()", true);
    await sleep(200);
    console.log('done');
  } catch (err) {
    console.error('TEST FAILED:', err.stack || err);
  } finally {
    win.destroy();
    app.exit(0);
  }
});
