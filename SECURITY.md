# 安全说明

## 报告问题

如果你发现密钥泄露、任意文件读写、跨站脚本或其他安全问题，请不要在公开 Issue 中粘贴利用细节、API Key 或书页原文。可以通过 GitHub 的私密安全报告（Security → Report a vulnerability）联系维护者。

## 密钥处理

- 桌面版自定义 API Key 用 Electron `safeStorage` 加密保存；内置 Our Free Model 服务的内部 Key 只在主进程读取。
- 移动 / PWA 版没有系统级安全存储，API Key 保存在本机 `localStorage`，并在设置界面明确提示。不要在不信任的设备上保存密钥。
- 仓库、Issue 和日志中不应出现任何真实 API Key。`ofm-catalog-seed.json` 只包含公开模型目录，不含凭据。

## 网络边界

- 桌面内置 AI 服务只监听 `127.0.0.1`，端口随机；渲染进程不接触内部 Key。
- PWA 只向用户配置的 AI Base URL 发起请求；Service Worker 不缓存跨源 AI 响应。
- 自定义 API 端点应使用 HTTPS，并正确配置 CORS。不要在生产环境中关闭浏览器同源策略。

## 数据

公开仓库不包含《红楼梦》正文与注释。不要通过 Issue 或 PR 上传书页数据、`book.json`、`data.js` 或含有原文的截图。
