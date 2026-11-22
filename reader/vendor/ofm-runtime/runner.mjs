// 阅读器内置 Our Free Model 服务的启动器。
// 由 Electron 主进程 fork，通过 IPC 报告实际端口和密钥文件，并在退出时优雅关闭服务。
import path from 'node:path';
import { startStandalone } from './packages/standalone/service.mjs';

function parseArgs(argv) {
  const options = { port: 0, dataDir: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--port') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 0 || value > 65535) {
        throw new Error('invalid port');
      }
      options.port = value;
    } else if (flag === '--data-dir') {
      options.dataDir = path.resolve(argv[++i]);
    }
  }
  return options;
}

let service = null;
let stopping = false;

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (service) {
    try { await service.close(); } catch { /* ignore */ }
  }
  process.exit(0);
}

try {
  const options = parseArgs(process.argv.slice(2));
  service = await startStandalone(options);
  const payload = {
    type: 'ready',
    product: service.product,
    version: service.version,
    url: service.url,
    port: service.port,
    keyFile: service.keyFile,
  };
  if (process.send) process.send(payload);
  else process.stdout.write(`ready ${service.url}\n`);
} catch (error) {
  const payload = {
    type: 'error',
    message: error && error.message ? error.message : String(error),
    code: error && error.code,
  };
  if (process.send) process.send(payload);
  else process.stderr.write(`${payload.message}\n`);
  process.exit(1);
}

process.on('message', (message) => {
  if (message && message.type === 'shutdown') shutdown();
});
// 父进程（阅读器）异常退出或直接被结束时，IPC 通道会关闭；不要留下孤儿服务。
process.on('disconnect', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (error) => {
  if (process.send) process.send({ type: 'error', message: error.message });
  shutdown();
});
process.on('unhandledRejection', (error) => {
  if (process.send) process.send({ type: 'error', message: error && error.message ? error.message : String(error) });
  shutdown();
});
