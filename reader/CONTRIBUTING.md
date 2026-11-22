# 贡献指南

感谢参与。这个项目同时维护 Electron 桌面版和 PWA 移动版，提交前请确认两端没有被破坏。

## 不要提交书页数据

请勿在 Issue、PR、截图或提交中包含以下内容：

- `chapters/`、`links/`、源文本文件；
- `reader/app/data.js`、`reader/app/book.json`；
- `背景信息.md`；
- 包含大段原文或出版社注释的截图/日志。

公开仓库只接受代码、文档、构建脚本和不含版权文本的测试数据。需要复现阅读界面时，请自行在本地生成数据，或用一两句公版文本构造最小样例。

## 开发

```bash
cd reader
npm install
npm start               # Electron
npm run build:mobile    # 重新生成 app/mobile-ai.js
npm run serve           # PWA 本地服务器
```

修改 `ai-main.js`、`mobile/entry.js` 或移动端 shim 后，必须重新执行 `npm run build:mobile`，否则移动端仍使用旧 bundle。

### 代码风格

- 主进程使用 CommonJS；浏览器端使用 IIFE，不引入框架。
- 保持现有中文文案风格，新增用户可见文字使用简体中文。
- 不把密钥、内部 API Key 或用户书页写进日志。
- 修改 UI 时同时检查 390px 手机宽度、1024px 平板宽度和 1360px 桌面宽度。

## 测试

至少运行：

```bash
node --check app/app.js
node --check app/ai.js
node --check ai-main.js
node mobile/build.mjs
```

如果本机有完整书源，再运行：

```bash
node_modules/electron/dist/electron.exe mobile/test-shot.js --no-sandbox
node_modules/electron/dist/electron.exe mobile/test-import.js --no-sandbox
node_modules/electron/dist/electron.exe mobile/test-ai.js --no-sandbox
```

测试产生的 `reader/shots-mobile/`、`reader/tmp-mobile-nodata/` 不要提交。

## 许可证

提交代码即表示你同意以本项目的 MIT 许可证发布你的贡献。不要提交你无权再分发的第三方内容；新增依赖请同时更新 `THIRD_PARTY_NOTICES.md`。
