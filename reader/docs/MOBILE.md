# 手机与平板版

同一套前端有两个交付方式：

1. **PWA**：部署到 HTTPS，用 Android Chrome / Edge 或 iPadOS Safari 安装到主屏幕。适合大多数用户，更新最方便。
2. **Android APK**：Capacitor 壳，内置同一套前端，可侧载安装。适合没有稳定 HTTPS 部署或希望有独立图标的用户。

两者都不在安装包中附带书页数据；首次打开会提示导入 `book.json`。

## PWA 安装

```bash
cd reader
npm install
npm run build:mobile
npm run serve
```

`http://127.0.0.1:8080/` 只适合本机调试。手机安装需要 HTTPS：

- GitHub Pages：仓库推送后由 `.github/workflows/pages.yml` 自动部署 `reader/app`；
- Cloudflare Pages / Netlify / Vercel：把 `reader/app` 作为静态目录；
- 自建 HTTPS 服务器。

部署后：

- Android Chrome：右上角菜单 →「安装应用」/「添加到主屏幕」；
- iPadOS Safari：分享 →「添加到主屏幕」。

安装后以独立窗口运行。首次打开没有数据时，点「选择 book.json」；文件只写入本机 IndexedDB。

> 通过局域网 `http://192.168.x.x` 访问不是安全上下文，Service Worker 不会注册，PWA 也不能安装。请使用 HTTPS。

## Android APK

### 直接安装

如果 Releases 中提供 APK：

1. 下载 `hlm-reader-*-debug.apk`；
2. Android 设置允许「安装未知应用」；
3. 安装后打开，导入 `book.json`；
4. 在 AI 设置中填写自己的 Anthropic 兼容 API。

APK 使用 debug 签名，适合个人侧载，不适合直接上架 Google Play。

### 从源码构建

要求：

- JDK 21+
- Android SDK Platform 36、Build-Tools 36
- 环境变量 `ANDROID_SDK_ROOT` 或 `ANDROID_HOME`

```bash
cd reader
npm install
npm run android:apk
```

脚本会：

1. 把 `app/` 复制到 `android-web/`，**排除 `data.js` 和 `book.json`**；
2. `cap sync android`；
3. 调用 Gradle `assembleDebug`。

输出：

```
reader/android/app/build/outputs/apk/debug/app-debug.apk
```

如果你想在 APK 中内置自己的书源，请先确认你有权再分发，然后修改 `mobile/prepare-android.mjs` 的 `EXCLUDE`，或在 `cap sync` 前把 `book.json` 放进 `android-web/`。公开 Release 不应包含这些内容。

## 移动端实现

- `mobile/entry.js`：把 `ai-main.js` 和官方 Anthropic SDK 打包成浏览器脚本，提供与 Electron preload 同名的 `window.hlmDesktop`。
- `mobile/electron-shim.js` / `fs-shim.js` / `path-shim.js` / `ofm-shim.js`：浏览器端替身。
- `mobile/build.mjs`：esbuild 构建到 `app/mobile-ai.js`。修改 AI 主逻辑后必须重新运行 `npm run build:mobile`。
- `mobile/serve.mjs`：本地静态服务器。
- `app/data-import.js`：IndexedDB 书源导入；桌面版同文件会调用 IPC 写入 `%APPDATA%`。
- `app/sw.js` + `manifest.webmanifest`：PWA 离线与安装。

### AI 节奏与复制

- 输入框上方可勾选「逐段带读」：每次只布置 1–3 段，读完后只讲解刚读的一小段，再给下一段。
- 每条回答底部提供「带索引 / 不带索引」复制；移动端复制按钮已加大触控区域。
- 无关《红楼梦》的提问会被拒绝，并进入 30 秒发送冷却。

### AI 与 CORS

移动端请求由浏览器/WebView 直接发往你配置的 Base URL。要求：

- 端点兼容 `POST /v1/messages`（Anthropic Messages）；
- 支持流式 SSE；
- 允许跨域（CORS）与 `x-api-key`、`anthropic-version`、`anthropic-dangerous-direct-browser-access` 请求头；
- 建议 HTTPS。Capacitor 壳允许明文 HTTP 方便本地网关，但公网使用 HTTP 会暴露密钥与内容。

Anthropic 官方 API 已支持浏览器直连。自建网关如果不方便开 CORS，建议在网关侧做反向代理，而不是关闭 WebView 安全策略。

### 键盘与布局

- 手机竖屏：顶栏两行（标题/操作 + 搜索），目录抽屉，注释底部面板，AI 全屏。
- 手机横屏：顶栏压成一行。
- 平板：目录抽屉 + 右侧浮动注释卡片，AI 居中浮动。
- 键盘弹出时通过 `visualViewport` 同步可见高度，避免输入框被遮住。

### 已知限制

- 中英文混杂输出：部分模型会在中文回答里夹杂英文，本项目不做后处理，复制时原样保留。

- 移动版不内置免费模型运行时，不能使用桌面版的 Kilo 免费池。
- API Key 存在 `localStorage`，没有系统级加密；公共设备上请用完后删除。
- 书源导入是整本 `book.json`，暂不支持在应用内直接导入 EPUB。
- Android APK 使用 debug 签名；正式上架需要自己的 release keystore 并配置 CI secret。
