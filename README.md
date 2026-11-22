# 红楼梦 · 桌面与移动阅读器

一个本地优先的《红楼梦》阅读器：Electron 桌面版 + 可安装到 Android / iPad 主屏幕的 PWA。支持目录、角标注释、全文搜索、阅读进度、AI 导读、段落级引用和分段带读。

> **这个仓库不包含《红楼梦》正文、注释或书页数据。**
> 程序代码以 MIT 发布；正文、人民文学出版社 2008 年版的注释/校记以及由它们生成的 `book.json` 不在 MIT 许可范围内。请使用你合法持有的源文件构建或导入。详见 [书源数据](reader/docs/DATA.md)。

## 在线体验

- **PWA 演示（不含书源）**：https://baizidog.github.io/hlm-reader/
- **Android APK**：[Releases](https://github.com/BaiZiDog/hlm-reader/releases)
- 在线版首次打开会提示导入 `book.json`；没有书源时只能看到导入页。

## 截图与界面

- 桌面：左侧目录、中间正文、右侧固定注释栏，注释角标可点击。
- 手机：目录变为左侧抽屉，注释变为底部面板，顶栏搜索与字号控制保留。
- 平板：目录抽屉 + 右侧浮动注释卡片；AI 窗在平板上居中浮动。
- 深色模式暂未提供；纸张色界面适合长时间阅读。

## 功能

- **目录**：119 个文档（第十七、十八回按底本合并），可筛选、自动定位当前回。
- **角标注释**：`[1]`、`[2]` 脚注和 `〔一〕`、`〔二〕` 校记均可点击；缺定义的 7 处会明确标注，并给出相邻校记。
- **全文搜索**：跨全书检索正文，支持回车跳转、高亮与前后文片段。
- **阅读进度**：自动保存当前回目和滚动位置。
- **AI 导读**：AI 通过工具查阅回目、检索正文、读取整回；回答中的 `第X回·pN` / `第X回 pA–pB` 可点击跳转并标红。
- **引用导航**：多个引用时底部出现「AI 引用 1/N」。
- **分段带读**：AI 标出具体段落范围、给出建议阅读时间并暂停；用户点「读完了，继续」后才讲解并布置下一段。
- **逐段节奏**：可勾选「逐段带读」，默认每次 1–3 段、约 100–350 字；首次只提示范围，读完后用 2–4 句话讲解，避免一次性生成整回。
- **复制回答**：每条回答可「带索引」或「不带索引」复制；不带索引会移除 `第X回·pN` 引用。
- **主题限制**：AI 先判断问题是否与《红楼梦》相关；无关问题拒绝回答，并禁用发送 30 秒。
- **离线阅读**：PWA 用 Service Worker 缓存界面，书源存 IndexedDB；AI 需要联网。

## 快速开始

### 桌面版（开发运行）

```bash
cd reader
npm install
npm start
```

打包 Windows 便携版：

```bash
python -I tools/pack_reader.py
```

输出 `reader/dist/红楼梦阅读器-win64/红楼梦阅读器.exe`。便携版需要本机已生成 `reader/app/data.js` 和 `book.json`。

### 手机 / 平板（PWA）

```bash
cd reader
npm install
npm run serve
```

打开 `http://127.0.0.1:8080/`。如果没有书页数据，页面会提示导入 `book.json`。部署到 HTTPS 后，在 Android Chrome 菜单选择「安装应用」，iPadOS Safari 选择「添加到主屏幕」。仓库的 Pages/Android 工作流模板在 `ci/`；启用方法见 [ci/README.md](ci/README.md)。

Android APK 可从 Releases 下载，或自行构建：

```bash
cd reader
npm install
npm run android:apk
```

需要 JDK 21+ 与 Android SDK Platform 36。APK 不包含正文，首次打开需导入 `book.json`。详见 [手机与平板](reader/docs/MOBILE.md)。

> 局域网 HTTP 不是安全上下文，无法注册 Service Worker 或安装 PWA；手机测试请用 HTTPS，或在本机用 localhost。

### 书源数据

公开仓库不分发正文。运行数据构建脚本（需要你合法持有的源文本）：

```bash
python -I tools/split_chapters.py "你的源文件.txt" chapters
python -I tools/build_annotation_links.py chapters links
python -I tools/build_reader_data.py
```

生成 `reader/app/data.js` 与 `reader/app/book.json`。移动端导入 `book.json` 即可；桌面版也可以从导入页选择它。完整说明见 [reader/docs/DATA.md](reader/docs/DATA.md)。

## AI 导读

- **桌面版**内置 Our Free Model 独立运行时，默认使用 Kilo 免费池 `reflection/beam-free`，不需要安装 OFM/DSH、Node 或 Bun。免费模型上游可能记录提示词，请勿发送敏感内容。
- **手机 / PWA**不能运行 Node 服务，需要使用你自己的 Anthropic Messages 兼容 API：在 AI 设置中填写 Base URL、API Key 和支持工具调用的模型。Anthropic 官方 API 支持浏览器直连；自建网关需配置 CORS 和 HTTPS。
- **主题限制**：常规提问会先用一个轻量请求判断是否与《红楼梦》或本阅读器相关；无关问题不读取章节，直接拒绝并进入 30 秒发送冷却。
- **API Key**：桌面版用 DPAPI 加密；移动版存在本机 `localStorage`，不随仓库或网络上传。公共设备上请在用完后删除。
- **隐藏背景信息**：可选的 `背景信息.md` 会作为隐藏系统上下文发送给 AI，不出现在界面中；公开仓库不包含该文件。

更多：[隐私说明](reader/PRIVACY.md) · [安全说明](SECURITY.md) · [第三方声明](reader/THIRD_PARTY_NOTICES.md)

## 目录结构

```
.
├── reader/
│   ├── main.js / preload.js / ai-main.js / ofm-service.js
│   ├── app/                 # 桌面与 PWA 共用前端
│   ├── mobile/             # 移动端 AI 桥、构建脚本、本地服务器、冒烟测试
│   ├── vendor/ofm-runtime  # 桌面内置免费模型运行时（MIT）
│   └── docs/DATA.md
├── tools/                  # 切分、注释链接、数据生成、打包
└── .github/workflows/      # GitHub Pages 部署 PWA
```

## 开发与测试

```bash
cd reader
npm run build:mobile   # 修改移动端 AI 桥后必须重新生成 app/mobile-ai.js
npm run serve
```

测试脚本需要本地完整书源：

```bash
node_modules/electron/dist/electron.exe mobile/test-shot.js --no-sandbox
node_modules/electron/dist/electron.exe mobile/test-import.js --no-sandbox
node_modules/electron/dist/electron.exe mobile/test-ai.js --no-sandbox
```

（Windows 路径；其他平台把 `node_modules/electron/dist/electron.exe` 换成对应 Electron 可执行文件。）详见 [CONTRIBUTING.md](reader/CONTRIBUTING.md)。

## 已知问题

- **中英文混杂输出**：部分免费模型或自定义 Anthropic 兼容端点会在中文回答中夹杂英文单词、短语或整句英文。这是模型输出本身的行为，本项目不尝试修复或过滤，复制回答时会原样保留。

## 许可

代码：[MIT](LICENSE)，Copyright (c) 2026 BaiZiDog。

书页数据、正文与出版社注释不属于 MIT 许可范围，仓库不包含它们。内置 Our Free Model 运行时、Anthropic SDK 等第三方组件按各自许可证分发，见 [THIRD_PARTY_NOTICES.md](reader/THIRD_PARTY_NOTICES.md)。

《红楼梦》原著为公版作品；不同出版社的校注、排版和整理成果可能另有权利。请自行确认你所使用版本的使用条件。
