// 开发期测试：移动端 AI 桥、Anthropic SSE、工具调用与分段带读。
'use strict';

const { app, BrowserWindow, clipboard } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'app');
const SHOTS = path.join(ROOT, 'shots-mobile');
const STATIC_PORT = 8800 + Math.floor(Math.random() * 100);
const MOCK_PORT = 8792;
let requestCount = 0;

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

async function waitFor(win, expression, timeout = 30000) {
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

function serveStatic() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${STATIC_PORT}`);
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
    server.listen(STATIC_PORT, '127.0.0.1', () => resolve(server));
  });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '600');
}

function sse(res, events) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  for (const event of events) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

function textEvents(text, stopReason = 'end_turn') {
  return [
    {
      type: 'message_start',
      message: {
        id: 'msg_mock', type: 'message', role: 'assistant', model: 'mock-model',
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 30 },
    },
    { type: 'message_stop' },
  ];
}

function toolEvents(id, name, input) {
  return [
    {
      type: 'message_start',
      message: {
        id: 'msg_mock', type: 'message', role: 'assistant', model: 'mock-model',
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    },
    {
      type: 'content_block_start', index: 0,
      content_block: { type: 'tool_use', id, name, input: {} },
    },
    {
      type: 'content_block_delta', index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 20 },
    },
    { type: 'message_stop' },
  ];
}

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      cors(res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
      }
      if (req.url.startsWith('/v1/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: [{ id: 'mock-model', display_name: 'Mock Model', type: 'model' }],
          has_more: false,
        }));
        return;
      }
      if (!req.url.startsWith('/v1/messages')) {
        res.writeHead(404).end();
        return;
      }
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(body); } catch { /* ignore */ }
        const system = typeof payload.system === 'string' ? payload.system : JSON.stringify(payload.system || '');
        if (system.includes('主题过滤器')) {
          const userText = JSON.stringify(payload.messages || []);
          const offTopic = /python|天气|股票|写.*代码|翻译.*英文/i.test(userText);
          console.log('mock topic:', offTopic ? 'NO' : 'YES');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'msg_topic',
            type: 'message',
            role: 'assistant',
            model: 'mock-model',
            content: [{ type: 'text', text: offTopic ? 'NO' : 'YES' }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 60, output_tokens: 1 },
          }));
          return;
        }
        requestCount += 1;
        console.log('mock request', requestCount, 'bytes', body.length, /<逐段带读模式>/.test(body) ? 'guided' : 'normal');
        if (requestCount === 1) {
          sse(res, toolEvents('toolu_read_1', 'read_chapter', { chapter: 1 }));
          return;
        }
        if (requestCount === 2) {
          sse(res, toolEvents('toolu_assign_1', 'assign_reading', {
            chapter: 1, start: 2, end: 3, focus: '注意作者自述的写作缘起。',
          }));
          return;
        }
        if (requestCount === 3) {
          sse(res, textEvents(
            '这一段是作者自述写作缘起：他说自己曾历过一番梦幻，将真事隐去，借“通灵”之说撰《石头记》。可对照 第1回 p2–p3 的原文细读。',
          ));
          return;
        }
        sse(res, textEvents('这一段把“真事隐”与“假语村言”并提，为全书定下虚实相生的基调。本次带读先到这里。'));
      });
    });
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server));
  });
}

app.whenReady().then(async () => {
  const staticServer = await serveStatic();
  const mockServer = await startMock();
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
    await win.loadURL(`http://127.0.0.1:${STATIC_PORT}/index.html`);
    await waitFor(win, 'Boolean(window.HLM_READER && window.HLM_READER.data && window.HLM_READER.data.chapters)');
    await sleep(700);
    await win.webContents.executeJavaScript("document.querySelector('#ai-open').click()", true);
    await win.webContents.executeJavaScript("document.querySelector('#ai-settings-open').click()", true);
    await sleep(300);
    await win.webContents.executeJavaScript(`(() => {
      const set = (sel, val) => {
        const el = document.querySelector(sel);
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('#ai-base-url', 'http://127.0.0.1:${MOCK_PORT}');
      set('#ai-key', 'mock-secret');
      set('#ai-model', 'mock-model');
      document.querySelector('#ai-save').click();
    })()`, true);
    await sleep(700);
    console.log('config:', await win.webContents.executeJavaScript(`JSON.stringify({
      chip: document.querySelector('#ai-model-chip').textContent,
      keyStatus: document.querySelector('#ai-key-status').textContent,
      savedKey: Boolean(localStorage.getItem('hlm.ai.key.v1')),
      settingsStatus: document.querySelector('#ai-settings-status').textContent,
    })`, true));
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('#ai-guided').click();
      document.querySelector('#ai-input').value = '带我读第一回的缘起部分';
      document.querySelector('#ai-send').click();
    })()`, true);
    await waitFor(win, "Boolean(document.querySelector('#ai-read-task') && !document.querySelector('#ai-read-task').hidden)");
    await sleep(500);
    console.log('reading:', await win.webContents.executeJavaScript(`JSON.stringify({
      range: document.querySelector('#ai-read-range').textContent,
      duration: document.querySelector('#ai-read-duration').textContent,
      timer: document.querySelector('#ai-read-timer').textContent,
      marked: document.querySelectorAll('.para.ai-reading').length,
      citationNav: !document.querySelector('#ai-cite-nav').hidden,
      aiHidden: document.querySelector('#ai-float').hidden,
      toast: document.querySelector('#toast').textContent,
      chat: document.querySelector('#ai-messages').innerText.slice(-220),
    })`, true));
    await shot(win, '08-ai-reading');
    console.log('guided:', await win.webContents.executeJavaScript(
      "JSON.stringify({checked:document.querySelector('#ai-guided').checked, context:document.querySelector('#ai-context').textContent})", true));
    console.log('copy buttons:', await win.webContents.executeJavaScript(
      "document.querySelectorAll('.ai-msg.assistant:last-child .ai-copy-btn').length", true));
    await win.webContents.executeJavaScript(`(() => {
      const msg = Array.from(document.querySelectorAll('.ai-msg.assistant')).at(-1);
      msg.querySelector('.ai-copy-btn[data-copy="index"]')?.click();
    })()`, true);
    await sleep(400);
    const clipA = await clipboard.readText();
    console.log('clipboard with index:', String(clipA || '').slice(0, 140));
    await win.webContents.executeJavaScript(`(() => {
      const msg = Array.from(document.querySelectorAll('.ai-msg.assistant')).at(-1);
      msg.querySelector('.ai-copy-btn[data-copy="plain"]')?.click();
    })()`, true);
    await sleep(400);
    const clipAPlain = await clipboard.readText();
    console.log('clipboard first without index:', String(clipAPlain || '').slice(0, 140));
    console.log('citation removed:', !/第1回/.test(String(clipAPlain || '')));

    await win.webContents.executeJavaScript("document.querySelector('#ai-read-done').click()", true);
    await sleep(1200);
    console.log('continued:', await win.webContents.executeJavaScript(`JSON.stringify({
      taskHidden: document.querySelector('#ai-read-task').hidden,
      chat: document.querySelector('#ai-messages').innerText.slice(-180),
    })`, true));
    await shot(win, '09-ai-continued');
    await win.webContents.executeJavaScript(`(() => {
      const msg = Array.from(document.querySelectorAll('.ai-msg.assistant')).at(-1);
      msg.querySelector('.ai-copy-btn[data-copy="plain"]')?.click();
    })()`, true);
    await sleep(400);
    const clipB = await clipboard.readText();
    console.log('clipboard without index:', String(clipB || '').slice(0, 180));
    console.log('requests total:', requestCount);

    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('#ai-input').value = '写一个 Python 快速排序';
      document.querySelector('#ai-send').click();
    })()`, true);
    await waitFor(win, "Boolean(document.querySelector('.ai-refusal'))", 15000);
    await sleep(400);
    console.log('refusal:', await win.webContents.executeJavaScript(`JSON.stringify({
      text: document.querySelector('.ai-refusal').textContent,
      hint: document.querySelector('#ai-hint').textContent,
      sendDisabled: document.querySelector('#ai-send').disabled,
      cooldownStored: Boolean(localStorage.getItem('hlm.ai.cooldown.v1')),
    })`, true));
    await shot(win, '10-refusal');
    console.log('backend cooldown:', await win.webContents.executeJavaScript(`(async () => {
      const r = await window.hlmDesktop.aiSend({ text: '再写一个 Python 程序', currentHui: 1, spoiler: false, guided: true });
      return JSON.stringify({ ok: r.ok, code: r.code, retryAfter: r.retryAfter });
    })()`, true));
    console.log('done');
  } catch (err) {
    console.error('TEST FAILED:', err.stack || err);
  } finally {
    win.destroy();
    staticServer.close();
    mockServer.close();
    app.exit(0);
  }
});
