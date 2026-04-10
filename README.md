# QQ Group Badge

为 QQ 群生成可嵌入 README 的徽章图片。服务会抓取公开 QQ 群邀请页，提取群名称、群号、人数和头像，并返回 SVG / WebP / PNG 图片。

在线生成器：

[https://qq-group-badge.ciallo.de5.net/](https://qq-group-badge.ciallo.de5.net/)

## 功能特性

- 支持从 `qm.qq.com` / `qun.qq.com` 邀请页获取群资料。
- 支持直接返回 README 可用的 SVG 徽章。
- 支持自定义 SVG 模板和占位符。
- 内置静态 SVG 模板和动画 SVG 模板。
- 提供网页生成器，可直接生成 Markdown、HTML 和图片直链。
- 支持通过外部渲染器把 HTML 模板渲染成 PNG / WebP。
- 支持使用 Cloudflare KV 和 R2 缓存渲染产物。

## 快速使用

推荐直接打开生成器：

[https://qq-group-badge.ciallo.de5.net/](https://qq-group-badge.ciallo.de5.net/)

使用步骤：

1. 输入 QQ 群邀请链接。
2. 选择静态模板、动画模板或自定义模板。
3. 点击生成代码。
4. 复制 Markdown 或 HTML 到 README。
5. 点击测试预览，确认徽章能正常加载。

也可以手动写 Markdown：

```md
[![QQ 群徽章](https://qq-group-badge.ciallo.de5.net/badge.svg?invite=https%3A%2F%2Fqm.qq.com%2Fq%2FknESGpUcdU)](https://qm.qq.com/q/knESGpUcdU)
```

## SVG 模板徽章

如果徽章用于 README，优先使用 `/badge.svg`。它由 Worker 直接生成，不需要等待外部渲染器，响应速度更稳定。

静态模板示例：

```md
[![QQ 群徽章](https://qq-group-badge.ciallo.de5.net/badge.svg?invite=https%3A%2F%2Fqm.qq.com%2Fq%2FknESGpUcdU&template=https%3A%2F%2Fraw.githubusercontent.com%2Fclown145%2Fqq-group-badge%2Fmain%2Fexamples%2Fgroup-badge-template.svg)](https://qm.qq.com/q/knESGpUcdU)
```

动画模板示例：

```md
[![QQ 群徽章](https://qq-group-badge.ciallo.de5.net/badge.svg?invite=https%3A%2F%2Fqm.qq.com%2Fq%2FknESGpUcdU&template=https%3A%2F%2Fraw.githubusercontent.com%2Fclown145%2Fqq-group-badge%2Fmain%2Fexamples%2Fgroup-animated-badge-template.svg)](https://qm.qq.com/q/knESGpUcdU)
```

内置模板地址：

| 模板 | 地址 |
| --- | --- |
| 静态 SVG | `https://raw.githubusercontent.com/clown145/qq-group-badge/main/examples/group-badge-template.svg` |
| 动画 SVG | `https://raw.githubusercontent.com/clown145/qq-group-badge/main/examples/group-animated-badge-template.svg` |

模板编写说明见 [SVG 模板徽章](docs/svg-template-badges.md)。

## 接口说明

### `GET /badge.svg`

返回 SVG 徽章。

参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `invite` 或 `url` | 是 | QQ 群邀请链接。 |
| `template` | 否 | 公开可访问的 SVG 模板 URL。不传时使用内置徽章布局。 |
| `label` | 否 | 内置徽章的标签文本，默认 `QQ GROUP`。 |
| `avatar=0` | 否 | 禁用头像嵌入。 |

响应类型：

```text
content-type: image/svg+xml; charset=utf-8
```

接口支持 `HEAD`，方便 GitHub 等平台探测图片响应。

### `GET /api/group.json`

返回标准化后的群资料。

```text
/api/group.json?invite=https%3A%2F%2Fqm.qq.com%2Fq%2FknESGpUcdU
```

### `GET /api/template.json`

拉取模板、注入占位符，并返回模板调试信息。

```text
/api/template.json?invite=<编码后的邀请链接>&template=<编码后的模板链接>
```

当模板没有按预期渲染时，优先用这个接口检查变量名和未解析占位符。

### `GET /badge.webp` 和 `GET /badge.png`

通过外部渲染器把 HTML 模板渲染成图片。

参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `invite` | 是 | QQ 群邀请链接。 |
| `template` | 是 | 公开可访问的 HTML 模板 URL。 |
| `animated=1` | 否 | 仅 `/badge.webp` 支持，返回 animated WebP。 |
| `width` | 否 | 渲染视口宽度。 |
| `height` | 否 | 渲染视口高度。 |
| `fps` | 否 | animated WebP 帧率。 |
| `duration_ms` | 否 | animated WebP 时长。 |

缓存行为：

- 产物已渲染完成时，直接返回 R2 中的 PNG / WebP。
- 新版本正在渲染且存在旧产物时，先返回旧产物，并在后台刷新。
- 完全没有可用产物时，返回临时 SVG 占位图，并触发后台渲染。

README 场景建议优先使用 `/badge.svg`。只有需要栅格图、复杂 HTML 布局或稳定动图时，再使用 WebP / PNG。

## 常用占位符

| 占位符 | 说明 |
| --- | --- |
| `{{group_name}}` | 群名称。 |
| `{{group_code}}` | 群号。 |
| `{{member_count_text}}` | 群人数文本。 |
| `{{avatar_data_url}}` | base64 头像，适合 SVG 模板。 |
| `{{invite_url}}` | 原始邀请链接。 |

完整列表见 [模板占位符](docs/template-placeholders.md)。

## 缓存与刷新

SVG 徽章默认使用短缓存：

```text
cache-control: public, max-age=300, s-maxage=300, stale-while-revalidate=3600
```

如果你刚修改模板，README 仍显示旧图，可以给图片 URL 添加版本参数：

```text
&v=20260411
```

`v` 参数只用于改变 URL，任意值都可以。

PNG / WebP 渲染产物存储在 R2，状态存储在 KV。默认 ready 状态保留 48 小时，对应 `RENDER_READY_TTL_SECONDS=172800`。

## 部署

安装依赖：

```bash
npm install
```

类型检查：

```bash
npm run check
```

部署 Worker：

```bash
npm run deploy
```

PNG / WebP 渲染缓存需要绑定：

| 绑定名 | 类型 | 用途 |
| --- | --- | --- |
| `RENDER_STATE` | KV namespace | 存储渲染状态。 |
| `RENDER_BUCKET` | R2 bucket | 存储渲染后的图片。 |

环境变量：

| 变量 | 是否必需 | 说明 |
| --- | --- | --- |
| `CACHE_VERSION` | 否 | 缓存版本号，默认 `v1`。 |
| `RENDERER_BASE_URL` | PNG / WebP 必需 | 外部渲染器地址。 |
| `RENDERER_SHARED_TOKEN` | 建议 | Worker 调用渲染器时使用的鉴权 token，建议配置为 Secret。 |
| `RENDER_CALLBACK_TOKEN` | 建议 | 渲染器回调 Worker 时使用的鉴权 token，建议配置为 Secret。 |
| `RENDER_PENDING_TTL_SECONDS` | 否 | pending 状态 TTL。 |
| `RENDER_FAILED_TTL_SECONDS` | 否 | failed 状态 TTL。 |
| `RENDER_READY_TTL_SECONDS` | 否 | ready 状态 TTL，默认部署使用 `172800` 秒。 |

如果使用默认 48 小时缓存，建议给 R2 bucket 配置 lifecycle rule：删除 `renders/` 前缀下超过 2 天的对象。

## 使用限制

- 服务依赖 QQ 邀请页可公开访问，且页面结构没有发生破坏性变化。
- GitHub 会缓存 README 图片，必要时使用 `&v=...` 刷新。
- 动画 SVG 在浏览器中通常可用，但 README 平台可能会限制或冻结动画。稳定动图建议使用 animated WebP。
- 模板 URL 必须直接返回原始 SVG 或 HTML 内容。

## 文档

用户文档：

- [SVG 模板徽章](docs/svg-template-badges.md)
- [模板占位符](docs/template-placeholders.md)

维护者文档：

- [QQ 邀请页抓取说明](docs/qm-share-page-scraping.md)
- [渲染缓存协议](docs/render-cache-protocol.md)
