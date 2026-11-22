'use strict';

/**
 * 浏览器 / 安卓 WebView 版没有 Node 运行时，无法 fork 内置 OFM 服务。
 * 保留同名接口，让桌面版代码可以在移动端复用；用户需配置自定义
 * Anthropic Messages 兼容 API。
 */

const MESSAGE = '移动版不内置免费模型服务。请在 AI 设置中使用自定义 Anthropic 兼容 API。';

function ensureService() {
  return Promise.reject(new Error(MESSAGE));
}

function fetchModels() {
  return Promise.reject(new Error(MESSAGE));
}

function stopService() {
  return Promise.resolve();
}

function status() {
  return { running: false, error: '', version: '' };
}

module.exports = { ensureService, fetchModels, stopService, status, MESSAGE };
