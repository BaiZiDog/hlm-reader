'use strict';

/**
 * 在阅读器内部启动 Our Free Model standalone 运行时。
 *
 * 用户不需要安装 OFM/DSH：运行时随阅读器打包，在 Electron 的 Node 模式下 fork。
 * 服务只监听 127.0.0.1，使用随机端口和独立数据目录里的 forwardKey；
 * 密钥只留在主进程，不返回渲染进程。
 */

const fs = require('node:fs');
const path = require('node:path');
const { fork, spawnSync } = require('node:child_process');
const { app } = require('electron');

const RUNTIME_DIR = path.join(__dirname, 'vendor', 'ofm-runtime');
const RUNNER = path.join(RUNTIME_DIR, 'runner.mjs');
const SEED_CATALOG = path.join(__dirname, 'app', 'ofm-catalog-seed.json');
const START_TIMEOUT_MS = 90000;
const STOP_TIMEOUT_MS = 4500;

let child = null;
let info = null;
let starting = null;
let lastError = '';
let logTail = '';

function dataDir() {
  return path.join(app.getPath('userData'), 'ofm');
}

function readForwardKey(keyFile) {
  const data = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  if (!data || typeof data.forwardKey !== 'string' || !data.forwardKey) {
    throw new Error('内置服务没有生成 API Key。');
  }
  return data.forwardKey;
}

function cleanLog() {
  return logTail
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/#login=[^\s]+/g, '#login=…')
    .replace(/forwardKey["':=\s]+[^\s,}]+/g, 'forwardKey=…')
    .trim();
}

function fail(message) {
  lastError = message;
  return new Error(message);
}

function killTree(pid) {
  if (!pid) return;
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch {
    try { process.kill(pid); } catch { /* ignore */ }
  }
}

function ensureService() {
  if (info && child && child.exitCode === null) return Promise.resolve(info);
  if (starting) return starting;

  starting = new Promise((resolve, reject) => {
    if (!fs.existsSync(RUNNER)) {
      starting = null;
      reject(fail('内置 AI 服务文件缺失，请重新安装阅读器。'));
      return;
    }
    const dir = dataDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      // 首次启动时写入一份公开的免费模型目录，避免上游目录刷新较慢时
      // Kilo 免费池（默认 kilo-auto/free）暂时不在 /v1/models 中。
      const catalogPath = path.join(dir, 'catalog.json');
      let needSeed = true;
      try {
        const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
        needSeed = !(Array.isArray(catalog.kiloRows) && catalog.kiloRows.length);
      } catch {
        needSeed = true;
      }
      if (needSeed && fs.existsSync(SEED_CATALOG)) {
        fs.copyFileSync(SEED_CATALOG, catalogPath);
      }
    } catch (err) {
      starting = null;
      reject(fail(`无法准备内置服务目录：${err.message}`));
      return;
    }

    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      starting = null;
      fn(value);
    };

    lastError = '';
    logTail = '';
    child = fork(RUNNER, ['--port', '0', '--data-dir', dir], {
      cwd: RUNTIME_DIR,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });

    child.stdout?.on('data', (chunk) => {
      logTail = (logTail + chunk.toString()).slice(-12000);
    });
    child.stderr?.on('data', (chunk) => {
      logTail = (logTail + chunk.toString()).slice(-12000);
    });

    child.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ready' && message.url && message.keyFile) {
        try {
          const key = readForwardKey(message.keyFile);
          info = {
            baseURL: message.url,
            key,
            port: message.port,
            keyFile: message.keyFile,
            version: message.version,
          };
          finish(resolve, info);
        } catch (err) {
          finish(reject, fail(`读取内置服务密钥失败：${err.message}`));
          if (child) child.kill();
        }
      } else if (message.type === 'error') {
        finish(reject, fail(message.message || '内置 AI 服务启动失败。'));
      }
    });

    child.on('error', (err) => {
      finish(reject, fail(`无法启动内置 AI 服务：${err.message}`));
    });

    child.on('exit', (code, signal) => {
      const tail = cleanLog();
      child = null;
      info = null;
      if (!settled) {
        finish(reject, fail(tail || `内置 AI 服务退出（code ${code}, signal ${signal}）。`));
      }
    });

    timer = setTimeout(() => {
      const tail = cleanLog();
      finish(reject, fail(tail || '内置 AI 服务启动超时。'));
      killTree(child && child.pid);
      child = null;
    }, START_TIMEOUT_MS);
  });

  return starting;
}

async function fetchModels(serviceInfo) {
  const target = serviceInfo || await ensureService();
  const response = await fetch(`${target.baseURL.replace(/\/+$/, '')}/v1/models`, {
    headers: { Authorization: `Bearer ${target.key}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`内置服务模型列表请求失败（HTTP ${response.status}）。`);
  }
  const json = await response.json();
  const rows = Array.isArray(json) ? json : (Array.isArray(json && json.data) ? json.data : []);
  const seen = new Set();
  const models = [];
  for (const row of rows) {
    const id = typeof row === 'string' ? row : (row && row.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id: String(id) });
    if (models.length >= 500) break;
  }
  return models;
}

async function stopService() {
  const current = child;
  child = null;
  info = null;
  if (!current || current.exitCode !== null) return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    current.once('exit', finish);
    try {
      current.send({ type: 'shutdown' });
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      if (done) return;
      try { current.kill(); } catch { /* ignore */ }
      killTree(current.pid);
      setTimeout(finish, 500);
    }, STOP_TIMEOUT_MS);
  });
}

function status() {
  return {
    running: Boolean(info && child && child.exitCode === null),
    error: lastError,
    version: info ? info.version : '',
  };
}

module.exports = {
  ensureService,
  fetchModels,
  stopService,
  status,
};
