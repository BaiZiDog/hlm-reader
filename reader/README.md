# 红楼梦 · 桌面与移动阅读器

《红楼梦》阅读器，桌面端基于 Electron，手机/平板端是同一套界面的 PWA（可安装到主屏幕）。正文、注释和位置索引全部由本地数据构建，阅读本身不需要网络；AI 导读需要联网。

公开仓库只包含程序代码与构建脚本，**不附带《红楼梦》正文、注释或书页数据**。请使用你合法持有的源文件构建，或在移动端导入生成的 `book.json`。详见 [DATA.md](docs/DATA.md)。

## 功能

- **目录**：119 个文档（第十七、十八回按底本合并），左侧目录可筛选、自动定位当前回。手机/平板上是左侧抽屉。
- **角标注释**：正文中的 `[1]`、`[2]` 脚注和 `〔一〕`、`〔二〕` 校记都是可点击角标。点击后显示释义；手机/平板上是底部注释面板，也可从「本章注释」列表反向定位角标。
- **缺定义提示**：原书有 7 个角标未收释义，阅读器会明确提示，并展示同一位置紧邻的校记作为参考，不把它冒充成该角标的注释。
- **缩放**：桌面 `Ctrl + 滚轮`、`Ctrl + = / - / 0`；移动端用顶栏的 − / ＋，范围 75%–200%，比例会记住。
- **全文搜索**：跨 119 个文档检索正文，支持回车跳转、结果高亮、前后文片段。
- **阅读进度**：自动保存当前回目和滚动位置，下次打开续读。
- **AI 导读**：右上角打开可拖拽悬浮窗；手机/平板上是全屏对话。AI 通过回目、检索、读回工具阅读正文与注释，回答中的引用可点击跳回原文。
- **正文跟随 AI**：AI 读取某一回时，正文自动跳到该回；回答完成后，被引用段落以淡红色标出，当前引用加深。同一回答有多个引用时，底部出现「AI 引用 1/3」导航条，可用 ‹ › 逐条跳转，× 关闭标红与导航。引用可以写成 `第X回 pA–pB`，整段范围一起标红。
- **AI 分段带读**：AI 可标出同一回内任意段落范围（pA–pB），给出建议阅读时间并暂停；正文底部显示「AI 带读」计时条和「读完了，继续」按钮。用户读完后点击，AI 先讲解这一段，再标出下一段；读完即停，不会抢在用户前面往下讲。跨回时 AI 会拆成两次任务。手机端布置任务后会自动收起 AI 窗口，让用户直接看到标红正文。
- **PWA 离线**：界面、脚本与已导入的书源由 Service Worker / IndexedDB 缓存，断网也能阅读；AI 仍需联网。

## 桌面版

打包后的目录：

```
reader/dist/红楼梦阅读器-win64/红楼梦阅读器.exe
```

双击即可，不需要安装 Node.js 或 Python。首次运行如遇 Windows SmartScreen，选择「更多信息 → 仍要运行」。压缩包：

```
reader/dist/红楼梦阅读器-1.0.0-win64.zip
```

### 开发运行

```bash
cd reader
npm install
npm start
```

或直接：

```bash
reader/node_modules/electron/dist/electron.exe reader
```

## 手机 / 平板（PWA）

1. 在电脑上启动本地服务器：

   ```bash
   cd reader
   npm install
   npm run serve
   ```

2. 浏览器打开 `http://127.0.0.1:8080/`。如果没有 `data.js`，页面会提示导入 `book.json`。
3. 部署到 HTTPS 后，Android Chrome / Edge 打开页面，菜单里选择「安装应用」或「添加到主屏幕」；iPadOS Safari 用「分享 → 添加到主屏幕」。
4. 安装后以独立窗口运行，支持离线打开已导入的书源。

> 手机通过局域网 IP 访问时，普通 HTTP 不是安全上下文，浏览器不会注册 Service Worker，也无法安装 PWA。请使用 HTTPS（例如 GitHub Pages、Cloudflare Pages）或本机 localhost 调试。

### Android APK

仓库同时包含 Capacitor Android 壳；安装包不包含书页数据，首次打开仍导入 `book.json`。

```bash
cd reader
npm install
npm run android:apk
```

输出 `reader/android/app/build/outputs/apk/debug/app-debug.apk`。需要 JDK 21+、Android SDK Platform 36/Build-Tools 36，并设置 `ANDROID_SDK_ROOT`。详细步骤与限制见 [docs/MOBILE.md](docs/MOBILE.md)。

### 书源导入

网页版和公开仓库不分发正文。请选择由构建脚本生成的 `book.json`：

- 桌面/网页：构建后文件在 `reader/app/book.json`。
- 手机导入时，文件只保存在本机浏览器 IndexedDB，不会上传；桌面版会同时写入 `%APPDATA%\红楼梦阅读器\book.json`，供 AI 主进程读取。
- 也兼容直接选择 `data.js`（会自动去掉 `window.HLM_DATA=` 外壳）。

### 构建移动端 AI 桥

移动端没有 Electron 主进程，`ai-main.js` 与官方 Anthropic SDK 会被 esbuild 打包成浏览器脚本：

```bash
cd reader
npm run build:mobile
```

生成 `app/mobile-ai.js`（约 1.6 MB）。桌面版加载同一个文件时会检测到 preload 注入的 `window.hlmDesktop` 并直接退出，不会重复初始化。

## AI 导读

### 桌面版：内置免费模型

桌面版自己启动内置的 Our Free Model 独立运行时（`reader/vendor/ofm-runtime`），不需要安装 OFM/DSH、Node.js 或 Bun。

- **默认模型**：`reflection/beam-free`（Kilo 免费池）。遇到限流或模型不可用时，会自动依次尝试 `openrouter/free`、`nvidia/nemotron-3.5-lightning:free`、`stealth/glyph-cluster`、`kilo-auto/free` 等备用模型。
- **模型选择**：AI 设置里可以「启动内置服务 / 刷新模型」，选择其他 Kilo 免费模型。部分 OpenCode 免费模型需要 Bun，本程序不附带 Bun，未安装时请使用 Kilo 模型。
- **隐私**：所选章节原文与注释会发送到免费模型上游（Kilo/OpenRouter 等）；免费池提示词可能被上游记录，请勿发送敏感内容。
- **服务数据**：内置服务只监听 `127.0.0.1`，数据和内部 API Key 在 `%APPDATA%\红楼梦阅读器\ofm`；退出阅读器时服务会关闭。

### 手机 / PWA：自定义 API

移动端不能 fork Node 运行时，因此不内置免费模型服务。请在 AI 设置中选择「自定义 API」或「Anthropic 官方」，填写：

- Base URL，例如 `https://api.anthropic.com`（不要带 `/v1`）
- API Key
- 一个支持工具调用（tool use）的模型 ID

要求端点兼容 Anthropic Messages（`/v1/messages`）并允许浏览器跨域请求。Anthropic 官方 API 支持浏览器直连；自建网关请配置 CORS，并建议使用 HTTPS。API Key 保存在本机 `localStorage`（没有系统级加密），请只在个人设备使用；设置面板会明确提示。

### 隐藏背景信息（可选）

如果存在 `%APPDATA%\红楼梦阅读器\背景信息.md`（或随包 `背景信息.md`），会作为隐藏系统上下文提供给 AI，不显示在界面/对话中。该内容会发送给模型，请勿放入 secrets。公开仓库不包含这个文件。

### 阅读工具与引用

- 工具：`list_chapters`、`search_book`、`read_chapter`、`assign_reading`。
- 引用格式：`第X回·pN` 或范围 `第X回 pA–pB`。
- 每次竞答最多读取 4 回；防剧透开启时只能读取当前回及之前的内容。
- 只要求标红而不带读时，直接在问题里写「第X回 pA–pB」即可；AI 不需要调用 `assign_reading`。

## 重新生成数据

正文或注释索引更新后：

```bash
python -I tools/build_reader_data.py
```

它会读取仓库根目录的 `chapters/*.txt` 与 `links/by_chapter/*.json`，校验每回 SHA-256、角标总数与注释引用，生成 `reader/app/data.js`（界面）和 `reader/app/book.json`（AI / 导入）。

完整数据构建流程见 [docs/DATA.md](docs/DATA.md)。

重新生成便携版：

```bash
python -I tools/make_reader_icon.py   # 可选，重新绘制图标
python -I tools/pack_reader.py
```

## 测试

开发期移动端冒烟测试（需要本机有完整的 `reader/app/data.js` / `book.json`）：

```bash
cd reader
node mobile/build.mjs
node_modules/electron/dist/electron.exe mobile/test-shot.js --no-sandbox
```

`mobile/test-import.js` 测试无 data.js 时的导入流程与离线启动；`mobile/test-ai.js` 使用本地 mock Anthropic SSE 服务测试移动端工具调用、分段带读与引用。它们不会在普通构建中运行。

## 快捷键（桌面）

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl` + 鼠标滚轮 | 缩放 |
| `Ctrl` + `=` / `Ctrl` + `-` / `Ctrl` + `0` | 放大 / 缩小 / 100% |
| `Ctrl` + `F` | 搜索 |
| `Enter` | 跳到第一处搜索结果 |
| `Esc` | 关闭搜索，或从注释详情返回本章列表 |
| `←` / `→` | 上一回 / 下一回 |
| `Ctrl` + `B` | 显示 / 隐藏目录 |
| `Ctrl` + `J` | 显示 / 隐藏注释栏 |

## 状态与位置

- 阅读进度、缩放、窗口位置：`%APPDATA%\红楼梦阅读器\reader-state.json`
- AI 设置（加密 Key、模型、剧透开关）：`%APPDATA%\红楼梦阅读器\ai-settings.json`
- 桌面导入的书页：`%APPDATA%\红楼梦阅读器\book.json`
- 内置免费模型服务数据 / 内部 Key：`%APPDATA%\红楼梦阅读器\ofm`
- 目录 / 注释栏显示偏好：浏览器 localStorage（`hlm.reader.prefs.v1`）
- 移动端书源：浏览器 IndexedDB（`hlm-reader` 库）

删除 `reader-state.json` 即可恢复首次打开状态；删除整个 `%APPDATA%\红楼梦阅读器` 会同时重置 AI 设置和内置模型服务。

## 目录结构

```
reader/
  main.js            Electron 主进程：窗口、缩放、状态持久化、书源导入
  ai-main.js         AI 设置、章节工具、工具循环、Anthropic 客户端
  ofm-service.js     启动/停止内置 Our Free Model 服务（桌面）
  preload.js         受限 IPC 接口
  package.json
  mobile/            移动端 AI 桥源码、esbuild 构建脚本、本地服务器
  vendor/ofm-runtime 内置 Our Free Model 独立运行时（MIT）
  app/
    index.html
    style.css
    ai.css
    mobile.css       手机/平板响应式布局
    app.js           目录、正文、注释、搜索、缩放交互
    ai.js            AI 悬浮窗、流式对话、设置、引用跳转
    mobile-ai.js     esbuild 生成的移动端 AI 桥
    platform.js      PWA 注册、平台探测
    data-import.js   book.json 导入（IndexedDB）
    manifest.webmanifest
    sw.js            Service Worker
    data.js          由正文与索引生成（不进入公开仓库）
    book.json        AI 工具 / 导入使用的纯 JSON（不进入公开仓库）
    ofm-catalog-seed.json
    icon.ico/png
  dist/              便携版输出（执行 pack_reader.py 后生成）
```

## 数据约定

- 位置以 `links/by_chapter/*.json` 为准，渲染时不重新解析角标，避免错位。
- 标注为 `missing_definition` 的 7 个角标保留精确位置：第 21 回 `[2]`、`[3]`，第 26 回 `[1]`，第 47 回 `[2]`、`[5]`，第 50 回 `[1]`、`[2]`。
- 第十七、十八回按底本合并为一个文档；目录显示「第十七回至十八回」。
- 全文搜索目前检索正文段落，不包含右侧注释释文。

## 许可

程序代码以 MIT 许可证发布；《红楼梦》正文、注释、书页数据不在本仓库中，也不在 MIT 许可范围内。内置 Our Free Model 运行时及其第三方组件按各自许可证分发，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
