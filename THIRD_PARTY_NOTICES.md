# 第三方组件与数据声明

本项目的**程序代码**以 MIT 许可证发布，详见仓库根目录的 `LICENSE`。
下列组件、数据与内容有各自的许可证或权利状态。

## Our Free Model 独立运行时

- 位置：`vendor/ofm-runtime`
- 来源：https://github.com/Ebony-Vinyl/dsh-our-free-model
- 许可证：MIT，Copyright (c) 2026 Ebony-Vinyl
- 许可证全文：`vendor/ofm-runtime/LICENSE`
- 其他第三方声明：`vendor/ofm-runtime/THIRD_PARTY_NOTICES.txt`、`vendor/ofm-runtime/vendor/channel-pack/LICENSE`、`vendor/ofm-runtime/vendor/channel-pack/NOTICE.md`

该运行时内含 React、models.dev 元数据及其他第三方代码，按运行时附带的 NOTICE 分发。

本仓库移除了上游运行时中硬编码的 Google OAuth 客户端密钥，详见 `vendor/VENDOR_PATCHES.md`。

## Anthropic SDK

- 位置：`app/mobile-ai.js`（esbuild 打包）与 `node_modules/@anthropic-ai/sdk`（开发依赖）
- 来源：https://github.com/anthropics/anthropic-sdk-typescript
- 许可证：Apache License 2.0（部分文件 MIT），全文见 `vendor/anthropic-sdk-LICENSE` 与 `vendor/anthropic-sdk-LICENSE-MIT`

### 打包进 mobile-ai.js 的 SDK 依赖

`app/mobile-ai.js` 还包含 Anthropic SDK 的少量运行时依赖，均为 MIT/Apache 许可：

- `@opentelemetry/api`：Apache-2.0，见 `vendor/bundled-mobile-licenses/opentelemetry-api-LICENSE`
- `@stablelib/base64`：MIT，见 `vendor/bundled-mobile-licenses/stablelib-base64-LICENSE`
- `fast-sha256`：MIT，见 `vendor/bundled-mobile-licenses/fast-sha256-LICENSE`
- `standardwebhooks`：MIT，见 `vendor/bundled-mobile-licenses/standardwebhooks-NOTICE.md`

## Electron / esbuild

- Electron：MIT，作为开发与打包依赖使用；便携版中的 Electron 运行时保留其原始许可证。
- esbuild：MIT，仅用于构建 `app/mobile-ai.js`。

## 《红楼梦》正文、注释与书页数据

公开仓库**不包含**《红楼梦》正文、人民文学出版社 2008 年版的注释/校记，也不包含由它们生成的 `data.js`、`book.json`、`chapters/`、`links/`。

这些内容的版权与使用条件由你使用的源文件决定，不属于本项目 MIT 许可范围。请只处理你合法持有的副本，并自行确认再分发条件。程序中的版本说明、注释链接工具和阅读界面不构成对第三方版本内容的授权。

## 书页数据生成物

`reader/app/data.js` 与 `reader/app/book.json` 是正文与注释的派生数据，公开仓库通过 `.gitignore` 排除。发布或分发这些文件前，请确认你对源内容拥有相应权利。
