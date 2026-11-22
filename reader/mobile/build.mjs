// 构建移动端 AI 桥：把 ai-main.js 和官方 Anthropic SDK 打包成浏览器 IIFE。
// 用法: node mobile/build.mjs
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'app', 'mobile-ai.js');

const browserShims = {
  name: 'hlm-browser-shims',
  setup(buildApi) {
    const resolveTo = (target) => ({
      path: path.join(HERE, target),
    });
    buildApi.onResolve({ filter: /^electron$/ }, () => resolveTo('electron-shim.js'));
    buildApi.onResolve({ filter: /^(node:)?fs$/ }, () => resolveTo('fs-shim.js'));
    buildApi.onResolve({ filter: /^(node:)?path$/ }, () => resolveTo('path-shim.js'));
    buildApi.onResolve({ filter: /^\.\/ofm-service$/ }, () => resolveTo('ofm-shim.js'));
  },
};

await build({
  entryPoints: [path.join(HERE, 'entry.js')],
  outfile: OUT,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110', 'safari16'],
  plugins: [browserShims],
  define: {
    'process.env': '__HLM_ENV__',
    __dirname: '"/"',
  },
  banner: {
    js: 'var __HLM_ENV__ = {};',
  },
  legalComments: 'none',
  logLevel: 'info',
});
console.log('mobile AI bundle:', OUT);
