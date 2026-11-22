// 准备 Capacitor 的 Web 资源：刻意排除 data.js / book.json，
// 避免把书页数据打进公开 APK；用户在应用内导入。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'app');
const DST = path.join(ROOT, 'android-web');
const EXCLUDE = new Set(['data.js', 'book.json', 'book.sample.json']);

fs.rmSync(DST, { recursive: true, force: true });
fs.mkdirSync(DST, { recursive: true });
for (const entry of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (EXCLUDE.has(entry.name)) continue;
  const from = path.join(SRC, entry.name);
  const to = path.join(DST, entry.name);
  fs.cpSync(from, to, { recursive: true });
}
console.log('android-web 已生成（不包含书页数据）:', DST);
