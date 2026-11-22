// 构建 Android debug APK：node mobile/build-android.mjs
// 需要设置 ANDROID_SDK_ROOT（或 ANDROID_HOME）；不会把本机路径写进仓库。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ANDROID = path.join(ROOT, 'android');

if (!fs.existsSync(ANDROID)) {
  console.error('找不到 android/，请先在 reader 目录运行: npx cap add android');
  process.exit(1);
}

const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
if (sdk) {
  fs.writeFileSync(
    path.join(ANDROID, 'local.properties'),
    `sdk.dir=${sdk.replace(/\\/g, '\\\\')}\n`,
    'utf8',
  );
}

const gradle = process.platform === 'win32'
  ? path.join(ANDROID, 'gradlew.bat')
  : path.join(ANDROID, 'gradlew');
if (process.platform !== 'win32') {
  try { fs.chmodSync(gradle, 0o755); } catch { /* ignore */ }
}
const result = spawnSync(gradle, ['assembleDebug'], {
  cwd: ANDROID,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});
process.exit(result.status === null ? 1 : result.status);
