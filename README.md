# qq-group-badge

一个运行在 Cloudflare Worker 上的 QQ 群徽章服务。

当前已经包含：

- 从 `qm.qq.com` / `qun.qq.com` 邀请页抓取群资料
- 输出 README 可用的 `SVG` 徽章
- 输出 README 可用的自定义 `SVG` 模板徽章
- 输出调试用 `group.json`
- 输出模板变量清单和编译后的 HTML 预览
- 输出 README 可直接使用的 PNG / WebP 模板渲染图片
- 输出 PNG / WebP 渲染的缓存状态入口、产物入口和回调入口
- 预留与 Hugging Face 渲染服务对接的请求协议

## 接口

### `GET /badge.svg`

查询参数：

- `invite` 或 `url`：QQ群邀请链接
- `template`：可选，SVG 模板 URL；提供后会把占位符注入模板并返回 `image/svg+xml`
- `label`：徽章左上角标签，默认 `QQ GROUP`
- `avatar=0`：禁用头像嵌入

示例：

```text
/badge.svg?invite=https%3A%2F%2Fqm.qq.com%2Fq%2FoTzIrdDBIc
```

Markdown 示例：

```md
[![QQ群徽章](https://your-worker.example.com/badge.svg?invite=https%3A%2F%2Fqm.qq.com%2Fq%2FoTzIrdDBIc)](https://qm.qq.com/q/oTzIrdDBIc)
```

SVG 模板示例：

```text
/badge.svg?invite=https%3A%2F%2Fqm.qq.com%2Fq%2FoTzIrdDBIc&template=https%3A%2F%2Fraw.githubusercontent.com%2Fclown145%2Fqq-group-badge%2Fmain%2Fexamples%2Fgroup-badge-template.svg
```

SVG 模板里可以用 `{{avatar_data_url}}` 内联群头像，适合 GitHub README。

详细用法见 [`docs/svg-template-badges.md`](docs/svg-template-badges.md)。

### `GET /badge.webp` / `GET /badge.png`

使用 HTML 模板渲染 README 可直接引用的图片。

查询参数：

- `invite`：QQ群邀请链接
- `template`：HTML 模板 URL
- `animated=1`：仅 `badge.webp` 有效，返回 animated WebP
- `width`
- `height`
- `fps`
- `duration_ms`

示例：

```text
/badge.webp?invite=https%3A%2F%2Fqm.qq.com%2Fq%2FoTzIrdDBIc&template=https%3A%2F%2Fraw.githubusercontent.com%2Fclown145%2Fqq-group-badge%2Fmain%2Fexamples%2Fgroup-card-template.html&animated=1&width=1000&height=500
```

`/render.webp` 和 `/render.png` 是同一功能的别名。

缓存策略：

- 当前 `render_key` 已完成时，直接返回 R2 里的 PNG / WebP。
- 当前内容变化且新图还在渲染时，优先返回上一次成功图片，并在后台触发新图。
- 完全没有可用缓存时，返回 `rendering` SVG 占位图，并在后台触发渲染。

### `GET /api/group.json`

返回标准化后的群资料 JSON。

示例：

```text
/api/group.json?invite=https%3A%2F%2Fqm.qq.com%2Fq%2FoTzIrdDBIc
```

### `GET /api/render.json`

这是 PNG / WebP 渲染的 JSON 调试入口。README 直接引用图片时优先使用 `/badge.webp` 或 `/badge.png`。

查询参数：

- `invite`：QQ群邀请链接
- `template`：HTML 模板 URL
- `format`：`png` / `webp`
- `animated`：仅 `format=webp` 时有效，`1` 表示 animated WebP
- `width`
- `height`
- `fps`
- `duration_ms`

当前如果没有配置 `RENDERER_BASE_URL`，会返回 `501`，但会给出 Worker 侧已经整理好的渲染请求结构和 `render_key`。

如果已经配置：

- `RENDER_STATE`
- `RENDER_BUCKET`
- `RENDERER_BASE_URL`

那这个接口会真正执行：

- 计算 `render_key`
- 查缓存状态
- 未命中时写入 `pending`
- 调用外部渲染器

### `GET /api/render-status.json`

根据 `render_key` 查询当前渲染状态。

示例：

```text
/api/render-status.json?render_key=<64位hex>
```

### `GET /rendered/:render_key`

返回最终渲染产物。

示例：

```text
/rendered/<64位hex>
```

### `POST /api/render/callback`

给外部渲染器回调使用。

支持：

- 二进制图片回调
- JSON base64 成功回调
- JSON 失败回调

### `GET /api/template.json`

返回模板编译结果的元信息，包括：

- `template_sha256`
- `compiled_sha256`
- `used_variables`
- `unresolved_variables`
- `variables`

示例：

```text
/api/template.json?invite=https%3A%2F%2Fqm.qq.com%2Fq%2FoTzIrdDBIc&template=https%3A%2F%2Fexample.com%2Ftemplate.html
```

### `GET /preview.html`

返回注入占位符后的 HTML，适合先调模板再接渲染器。

示例：

```text
/preview.html?invite=https%3A%2F%2Fqm.qq.com%2Fq%2FoTzIrdDBIc&template=https%3A%2F%2Fexample.com%2Ftemplate.html
```

## 本地开发

```bash
npm install
npm run dev
```

## 部署

```bash
npm run deploy
```

## 环境变量

- `CACHE_VERSION`：缓存版本号，默认 `v1`
- `RENDERER_BASE_URL`：后续外部渲染服务地址
- `RENDERER_SHARED_TOKEN`：Worker 调用外部渲染服务的鉴权 token
- `RENDER_CALLBACK_TOKEN`：外部渲染器回调 Worker 的鉴权 token
- `RENDER_PENDING_TTL_SECONDS`：`pending` 状态 TTL
- `RENDER_FAILED_TTL_SECONDS`：`failed` 状态 TTL
- `RENDER_READY_TTL_SECONDS`：`ready` 状态 TTL，默认 `172800`，即 48 小时；设置为 `0` 表示不设置 ready TTL，非 0 值会按至少 60 秒处理

## Cloudflare 绑定

PNG / WebP 渲染缓存链路还需要：

- `RENDER_STATE`
  `KVNamespace`
- `RENDER_BUCKET`
  `R2Bucket`

如果使用默认 48 小时缓存策略，还需要在 R2 bucket 上配置 lifecycle rule：

- prefix：`renders/`
- expire/delete after：2 days

## 抓取说明

页面结构分析见 [docs/qm-share-page-scraping.md](/data/data/com.termux/files/home/qq-group-badge/docs/qm-share-page-scraping.md)。

模板占位符说明见 [docs/template-placeholders.md](/data/data/com.termux/files/home/qq-group-badge/docs/template-placeholders.md)。

渲染缓存协议见 [docs/render-cache-protocol.md](/data/data/com.termux/files/home/qq-group-badge/docs/render-cache-protocol.md)。
