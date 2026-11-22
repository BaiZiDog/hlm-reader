'use strict';

/** 浏览器端最小 path 实现（只用于 ai-main 的虚拟路径）。 */
function join(...parts) {
  const chunks = [];
  for (const part of parts) {
    if (part === undefined || part === null || part === '') continue;
    chunks.push(String(part));
  }
  const joined = chunks.join('/').replace(/\/+/g, '/');
  if (joined.length > 1 && joined.endsWith('/')) return joined.slice(0, -1);
  return joined || '.';
}

function dirname(file) {
  const p = String(file).replace(/\\/g, '/').replace(/\/+$/, '');
  const at = p.lastIndexOf('/');
  if (at < 0) return '.';
  if (at === 0) return '/';
  return p.slice(0, at);
}

function basename(file) {
  const p = String(file).replace(/\\/g, '/').replace(/\/+$/, '');
  const at = p.lastIndexOf('/');
  return at < 0 ? p : p.slice(at + 1);
}

module.exports = { join, dirname, basename };
