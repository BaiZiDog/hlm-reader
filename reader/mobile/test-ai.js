// 开发期测试：移动端 AI 桥、Anthropic SSE、工具调用与分段带读。
'use strict';

const { app, BrowserWindow } = require('electron');
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
        requestCount += 1;
        console.log('mock request', requestCount, 'bytes', body.length);
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

    await win.webContents.executeJavaScript("document.querySelector('#ai-read-done').click()", true);
    await sleep(1200);
    console.log('continued:', await win.webContents.executeJavaScript(`JSON.stringify({
      taskHidden: document.querySelector('#ai-read-task').hidden,
      chat: document.querySelector('#ai-messages').innerText.slice(-180),
    })`, true));
    await shot(win, '09-ai-continued');
    console.log('requests total:', requestCount);
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
