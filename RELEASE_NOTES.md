## 红楼梦阅读器 1.0.0

首个公开版本，包含 Electron 桌面版源码、手机/平板 PWA 与 Android 壳。

### 下载

- **Android APK**：`hlm-reader-1.0.0-debug.apk`（debug 签名，适合侧载）。
- **源码**：GitHub 自动生成的 Source code 压缩包。
- PWA：仓库启用 GitHub Pages 后访问 `https://baizidog.github.io/hlm-reader/`。

安装包和公开仓库**不包含《红楼梦》正文、注释或 book.json**。首次打开请导入你自己构建的 `book.json`。

### 功能

- 目录、角标注释、缺定义提示、全文搜索、阅读进度、字号缩放。
- AI 导读：正文跟随、引用标红、多引用导航、段落范围引用。
- AI 分段带读：建议阅读时间、倒计时、「读完了，继续」。
- 手机/平板响应式布局：目录抽屉、底部注释、全屏 AI、横屏适配。
- PWA 离线阅读；书源存 IndexedDB。
- 桌面版内置 Our Free Model 免费模型运行时；移动版使用自定义 Anthropic 兼容 API。

### 安装说明

1. 在设置中允许安装未知来源应用。
2. 安装 APK 或打开 PWA。
3. 选择 `book.json` 导入书页（只存本机）。
4. AI 设置中填写 Base URL、API Key 与支持工具调用的模型。

Android APK 为 debug 签名，不适合直接上架 Google Play；正式发布请自行配置 release keystore。

### 许可与数据

程序代码 MIT。正文、人民文学出版社 2008 年版注释/校记及派生数据不在 MIT 范围内，公开仓库不包含它们。使用前请确认你对源文件拥有相应权利。
