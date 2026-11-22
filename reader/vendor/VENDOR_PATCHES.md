# 内置运行时补丁

## Our Free Model：移除 Google OAuth 客户端密钥

文件：`ofm-runtime/packages/standalone/channels/business.mjs`

上游的独立服务包在 `GEMINI_DEFAULT_CLIENT_SECRET` 中硬编码了一个 Google OAuth
客户端密钥。公开仓库不能分发该值，因此本仓库将其置空：

```js
var GEMINI_DEFAULT_CLIENT_SECRET = "";
```

需要 Gemini OAuth 登录时，通过环境变量提供自己的客户端密钥：

```bash
set CMDC_PAK_GOOGLE_CLIENT_SECRET=your-client-secret
```

这只影响 Gemini 的 OAuth 免费通道；默认的 Kilo/OpenRouter 免费模型不需要它。
其余运行时文件保持上游版本。

## 第二处 Gemini OAuth 默认值

文件：`ofm-runtime/src/subscriptions.js`

同样移除了硬编码的 Google OAuth 客户端 ID / 密钥默认值，改为从
`GEMINI_CLIENT_ID` / `GEMINI_CLIENT_SECRET` 环境变量读取。未设置时该通道不可用，
不影响 Kilo/OpenRouter 免费模型。

同时移除了同一文件中的 Gemini OAuth 默认客户端 ID。可通过
`CMDC_PAK_GOOGLE_CLIENT_ID` / `CMDC_PAK_GOOGLE_CLIENT_SECRET` 环境变量提供。
