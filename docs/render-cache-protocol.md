# 渲染缓存协议

更新时间：2026-04-10

这份协议描述的是 Worker 和外部渲染器之间的协作方式，以及 Worker 内部如何缓存渲染状态与产物。

## 目标

同一个模板和同一份群数据，只要编译后 HTML 不变，就得到同一个 `render_key`。

这样可以做到：

- 重复请求不重复渲染
- 渲染中可以返回 `pending`
- 渲染完成后直接命中缓存产物
- README 或外部客户端可以直接用固定的产物 URL

## 依赖的 Cloudflare 绑定

要让这套缓存真正工作，Worker 侧需要同时配置：

- `RENDER_STATE`
  `KVNamespace`，存渲染状态
- `RENDER_BUCKET`
  `R2Bucket`，存渲染好的二进制产物

没有这两个绑定时，`/api/render.json` 会返回：

- `render_storage_not_configured`

## 状态模型

当前状态只有 3 种：

- `pending`
- `ready`
- `failed`

KV 里存的是一条 `RenderStateRecord`，核心字段包括：

- `renderKey`
- `status`
- `createdAt`
- `updatedAt`
- `request.templateUrl`
- `request.templateSha256`
- `request.compiledSha256`
- `request.group`
- `request.options`
- `job.attempts`
- `job.lastAttemptAt`
- `result.objectKey`
- `result.contentType`
- `result.contentLength`
- `result.etag`
- `error.code`
- `error.message`

## 产物存储

R2 对象键当前固定为：

```text
renders/<render_key>
```

Worker 侧对外暴露的读取地址是：

```text
/rendered/<render_key>
```

这是最终给 README 或其它消费者稳定引用的地址。

## 入口接口

### `GET /api/render.json`

作用：

- 根据 `invite + template + render params` 计算 `render_key`
- 查 KV 看当前状态
- 已完成则直接返回 `ready`
- 正在渲染则返回 `pending`
- 未命中则写入 `pending` 并请求外部渲染器

查询参数：

- `invite`
- `template`
- `format`
- `width`
- `height`
- `fps`
- `duration_ms`
- `retry=1`
  如果当前状态是 `failed`，允许重试入队

### `GET /api/render-status.json?render_key=...`

作用：

- 只根据 `render_key` 查状态
- 不再重新抓群页，也不重新拉模板

适合外部轮询。

### `GET /rendered/<render_key>`

作用：

- 从 R2 读取最终图片或动图
- 只要状态是 `ready`，就返回二进制产物

当前会返回这些头：

- `content-type`
- `etag`
- `cache-control: public, max-age=31536000, immutable`
- `x-render-key`

## 回调接口

### `POST /api/render/callback`

作用：

- 外部渲染器回传最终结果
- 或回传失败状态

如果配置了 `RENDER_CALLBACK_TOKEN`，则需要：

```text
Authorization: Bearer <RENDER_CALLBACK_TOKEN>
```

## 回调格式

### 1. 二进制成功回调

最适合图片/GIF 这种最终产物。

请求方式：

```text
POST /api/render/callback?render_key=<key>&content_type=image/png
Content-Type: image/png
Authorization: Bearer <token>

<binary body>
```

支持的 `content_type` 应该是 `image/*`。

### 2. JSON 成功回调

适合一些调试或小文件场景。

```json
{
  "render_key": "<64位hex>",
  "status": "ready",
  "content_type": "image/png",
  "data_base64": "..."
}
```

### 3. JSON 失败回调

```json
{
  "render_key": "<64位hex>",
  "status": "failed",
  "error": {
    "code": "render_timeout",
    "message": "Renderer exceeded time limit"
  }
}
```

## Worker 发给渲染器的请求体

`/api/render.json` 首次命中未缓存结果时，Worker 会把这份结构 POST 到：

```text
<RENDERER_BASE_URL>/render
```

除了模板、变量、群数据和渲染参数外，还会包含：

- `callback.url`
- `callback.bearerToken`
- `result.assetUrl`
- `result.statusUrl`

也就是说，渲染器不需要自己猜回调地址或产物地址。

## 当前状态流

### 首次请求

1. 客户端请求 `GET /api/render.json?...`
2. Worker 计算 `render_key`
3. KV 未命中
4. Worker 写入 `pending`
5. Worker 调外部渲染器
6. Worker 返回 `202 pending`

### 渲染完成

1. 渲染器 `POST /api/render/callback`
2. Worker 把产物写入 R2
3. Worker 把状态更新为 `ready`
4. 后续再请求 `/api/render.json` 时直接返回 `ready`
5. 客户端直接用 `/rendered/<render_key>`

### 渲染失败

1. 渲染器回调 `failed`
2. Worker 写入 `failed`
3. 后续请求 `/api/render.json` 默认直接返回 `failed`
4. 带 `retry=1` 时会重新写 `pending` 并再次请求渲染器

## TTL 和 R2 删除

当前实现里：

- `pending` 默认 TTL：15 分钟
- `failed` 默认 TTL：30 分钟
- `ready` 默认 TTL：48 小时

可通过环境变量覆盖：

- `RENDER_PENDING_TTL_SECONDS`
- `RENDER_FAILED_TTL_SECONDS`
- `RENDER_READY_TTL_SECONDS`

`RENDER_READY_TTL_SECONDS` 默认值是：

```text
172800
```

也就是 48 小时。

设置为 `0` 表示 Worker 不给 `ready` 状态设置 KV TTL，同时产物响应会重新使用长缓存：

```text
public, max-age=31536000, immutable
```

非 0 TTL 会被 Worker 归一化为至少 60 秒，避免 KV `expirationTtl` 太小导致运行时报错。

如果是默认 48 小时，Worker 会：

- 给 KV 里的 `ready` 状态设置 48 小时 TTL
- 给 R2 对象写入 `expires_at` 和 `ttl_seconds` 元数据
- 给 `/rendered/<render_key>` 响应写入 `cache-control: public, max-age=172800`

但 R2 对象的物理删除不是 Worker 变量直接控制的。R2 自动删除需要在 Cloudflare R2 bucket 上配置 lifecycle rule：

- prefix：`renders/`
- action：expire/delete objects
- age：2 days

也就是说，推荐保持：

```text
RENDER_READY_TTL_SECONDS=172800
R2 lifecycle: renders/ prefix, expire after 2 days
```

如果你把 `RENDER_READY_TTL_SECONDS` 改成其它值，也应该同步调整 R2 lifecycle rule。R2 lifecycle 通常按天配置，所以 Worker TTL 可以更细，但物理删除建议按接近的天数设置。

## R2 与 KV 不一致时的处理

如果 KV 里还是 `ready`，但 R2 对象已经被 lifecycle 删除：

- `/api/render.json` 会把它当作 cache miss
- `/api/render-status.json` 会返回 missing
- Worker 会删除这条过期 KV 状态
- 下一次请求会重新进入渲染流程

## 现在还没做的事

- 没有 Durable Object 锁，所以严格意义上的全局强去重还没做
- 没有 Worker Cron 主动扫描和删除旧 R2 产物，依赖 R2 lifecycle 做物理删除
- 没有多版本模板迁移策略

但就 Worker 与外部渲染器的基本协作而言，这份协议已经够用了。
