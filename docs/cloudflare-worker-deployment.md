# Cloudflare Worker 部署指南

这份文档讲的是把你自己的 fork 部署到 Cloudflare Workers。

推荐流程不是直接在本地跑 `wrangler deploy`，而是：

1. 先 fork 本项目。
2. 在 Cloudflare 里连接这个 fork，走 Git 自动部署。
3. 通过 Cloudflare Dashboard 配变量、Secret、KV 和 R2 绑定。

这样更稳，尤其是在 Android / Termux 环境里，本地 `wrangler deploy` 可能因为 `workerd` 平台支持问题失败。

这份文档默认按“Cloudflare Web 配置优先”来写：

- `wrangler.toml` 只保留最小必要配置
- 变量和 Secret 尽量在 Dashboard 管
- KV / R2 也优先在 Dashboard 里创建和绑定

如果你后面想把仓库变成唯一配置源，再把 Dashboard 生成的配置片段回写到 `wrangler.toml` 即可。

## 部署模式

这个项目有两种部署模式：

### 模式 A：只跑 SVG

只使用这些接口：

- `/badge.svg`
- `/api/group.json`
- `/api/template.json`
- `/preview.html`

这种模式不需要 KV、R2，也不需要 Hugging Face 渲染器。

注意：

- 不绑定 `RENDER_BUCKET` 时，SVG 只能使用 Cloudflare 边缘缓存，不能使用 R2 持久缓存。

### 模式 B：完整模式

除了 SVG，还启用：

- `/badge.webp`
- `/badge.png`
- `/api/render-status.json`
- `/rendered/<render_key>`

这种模式需要：

- 1 个 KV namespace
- 1 个 R2 bucket
- 1 个外部 HTML 渲染器

如果你已经按当前项目的方式部署了 Hugging Face Space 渲染器，就选这个模式。

同一个 `RENDER_BUCKET` 会同时用于：

- PNG / WebP 渲染结果
- SVG 徽章的 R2 持久缓存

## 第 1 步：Fork 仓库

先 fork 本项目到你自己的 GitHub 账号。

后面的 Cloudflare Git 部署，连接的是你自己的 fork，不是上游仓库。

你对 `wrangler.toml` 的修改，也要提交到你自己的 fork，Cloudflare 构建时读取的是仓库里的内容，不是你本地未提交的文件。

## 第 2 步：确认 `wrangler.toml`

这个文件在仓库根目录：

[`wrangler.toml`](/data/data/com.termux/files/home/qq-group-badge/wrangler.toml)

默认不需要大改，但你至少要确认下面这些点。

### 2.1 `name` 是否要改

```toml
name = "qq-group-badge"
```

如果你准备在 Cloudflare 里创建的 Worker 名字也叫 `qq-group-badge`，那这一项可以不改。

只有在你想用自己的 Worker 名字时，才需要改，例如：

```toml
name = "my-qq-group-badge"
```

Cloudflare 连接 Git 仓库时，Dashboard 里的 Worker 名字必须和这里的 `name` 完全一致，不然构建会失败。

### 2.2 `main` 和 `compatibility_date` 保持即可

这两项通常不用动：

```toml
main = "src/index.ts"
compatibility_date = "2026-04-10"
```

### 2.3 如果你想在 Dashboard 管文本变量

如果你打算把 `CACHE_VERSION`、`RENDER_READY_TTL_SECONDS`、`RENDERER_BASE_URL` 这类文本变量放在 Cloudflare Web 里维护，建议在你自己的 fork 里加上：

```toml
keep_vars = true
```

原因：

- Cloudflare 官方建议把 Wrangler 配置当成 source of truth
- 如果你在 Dashboard 改变量，下一次 Git / Wrangler 部署可能会把它们覆盖回仓库里的 `[vars]`
- `keep_vars = true` 可以减少这种覆盖问题

### 2.4 这份仓库里现有的 KV / R2 绑定不能直接照搬

当前仓库里的 `wrangler.toml` 包含的是现有项目自己的绑定示例：

```toml
[[kv_namespaces]]
binding = "RENDER_STATE"
id = "..."

[[r2_buckets]]
binding = "RENDER_BUCKET"
bucket_name = "..."
```

这些值不是 fork 后所有人通用的。

如果你准备完全在 Cloudflare Web 里绑定自己的 KV / R2，那么在你自己的 fork 里，建议把这些旧的 `[[kv_namespaces]]` / `[[r2_buckets]]` 段落删掉，避免仓库配置和线上配置打架。

### 2.5 只跑 SVG 时的最小配置

如果你只想跑 SVG，建议你的 fork 最终只保留类似这样一份最小 `wrangler.toml`：

```toml
name = "your-worker-name"
main = "src/index.ts"
compatibility_date = "2026-04-10"
keep_vars = true
```

只跑 SVG 时：

- 不需要 KV
- 不需要 R2
- 不需要 Hugging Face 渲染器
- `/badge.webp` 和 `/badge.png` 不会工作

## 第 3 步：创建 Cloudflare 资源

这一节只针对完整模式。

### 3.1 创建 KV namespace

创建一个 KV namespace，例如：

```text
qq-group-badge-kv
```

创建完之后，进入你的 Worker，在 Dashboard 里把它绑定成：

- Binding name：`RENDER_STATE`
- Resource：你刚创建的 KV namespace

### 3.2 创建 R2 bucket

创建一个 R2 bucket，例如：

```text
qq-group-badge-renders
```

创建完之后，进入你的 Worker，在 Dashboard 里把它绑定成：

- Binding name：`RENDER_BUCKET`
- Resource：你刚创建的 R2 bucket

如果你后面想把这些绑定同步回仓库，Cloudflare Dashboard 会给出对应的 TOML 片段，到时候再回填到 `wrangler.toml` 即可。

## 第 4 步：配置 R2 lifecycle rule

这一节只针对完整模式。

本项目会把不同类型的对象写到同一个 R2 bucket 的不同前缀下：

```text
renders/
svg-meta/
svg-body/
```

代码位置：

[`src/render-cache.ts`](/data/data/com.termux/files/home/qq-group-badge/src/render-cache.ts)

对应对象 key：

```ts
renders/<render_key>
svg-meta/<alias_key>.json
svg-body/<compiled_sha>.svg
```

默认配置里：

```text
RENDER_READY_TTL_SECONDS = 172800
SVG_CACHE_SOFT_TTL_SECONDS = 300
SVG_CACHE_HARD_TTL_SECONDS = 2592000
```

也就是：

- PNG / WebP ready 缓存：48 小时
- SVG 缓存软刷新窗口：5 分钟
- SVG 缓存硬过期：30 天

因此推荐你在 R2 bucket 上至少加这三条 lifecycle rule：

- `renders/`：对象创建后 2 天删除
- `svg-meta/`：对象创建后 30 天删除
- `svg-body/`：对象创建后 30 天删除

Dashboard 路径：

1. 打开 Cloudflare Dashboard。
2. 进入 R2 Object Storage。
3. 选择你的 bucket。
4. 打开 `Settings`。
5. 找到 `Object lifecycle rules`。
6. 分别为 `renders/`、`svg-meta/`、`svg-body/` 添加删除规则。

建议：

- 如果你保持 `RENDER_READY_TTL_SECONDS=172800`，就把 `renders/` 规则设成 2 天。
- 如果你保持 `SVG_CACHE_HARD_TTL_SECONDS=2592000`，就把 `svg-meta/` 和 `svg-body/` 规则设成 30 天。
- 如果你改了 Worker 里的硬 TTL，R2 lifecycle 也要同步改。
- `SVG_CACHE_SOFT_TTL_SECONDS` 只影响后台刷新频率，不影响 R2 lifecycle 删除时间。

R2 lifecycle 删除是异步执行的，不是精确到秒触发，实际清理会有延迟。

## 第 5 步：连接 Git 仓库到 Cloudflare Workers

推荐直接用 Cloudflare 的 Git 构建部署。

Dashboard 路径：

1. 打开 `Workers & Pages`。
2. 选择 `Create application`。
3. 选择 `Import a repository`。
4. 连接你的 GitHub 账号。
5. 选择你 fork 出来的仓库。
6. 保存并部署。

如果你是把仓库连接到一个“已存在的 Worker”：

1. 打开这个 Worker。
2. 进入 `Settings`。
3. 进入 `Builds`。
4. 选择 `Connect`。
5. 选择你的仓库并完成配置。

最重要的一条：

- Cloudflare 里的 Worker 名字必须和 `wrangler.toml` 里的 `name` 一致。

推荐构建设置：

- Root directory：仓库根目录 `/`
- Deploy command：`npx wrangler deploy`

如果你已经保留了 `package.json` 里的脚本，也可以用：

```text
npm run deploy
```

## 第 6 步：在 Dashboard 设置变量和 Secret

Cloudflare Dashboard 路径：

1. 打开 `Workers & Pages`。
2. 进入你的 Worker。
3. 进入 `Settings`。
4. 打开 `Variables and Secrets`。
5. 逐个添加。

默认建议这些值都放在 Dashboard 里，不写死在 fork 的 `wrangler.toml`。

### 6.1 文本变量

| 变量名 | 是否必需 | 推荐值 | 说明 |
| --- | --- | --- | --- |
| `CACHE_VERSION` | 否 | `v1` | 改这个值可以整体切换缓存版本。 |
| `SVG_CACHE_SOFT_TTL_SECONDS` | 否 | `300` | SVG 缓存软 TTL；到期后优先返回旧图并后台刷新。 |
| `SVG_CACHE_HARD_TTL_SECONDS` | 否 | `2592000` | SVG 缓存硬 TTL；默认 30 天。 |
| `RENDER_READY_TTL_SECONDS` | 完整模式建议 | `172800` | ready 状态和渲染产物保留时间，默认 48 小时。 |
| `RENDERER_BASE_URL` | 完整模式必需 | `https://your-space-name.hf.space` | 你的 Hugging Face 渲染器地址。 |
| `RENDER_PENDING_TTL_SECONDS` | 否 | 留空 | pending 状态 TTL，默认 900 秒。 |
| `RENDER_FAILED_TTL_SECONDS` | 否 | 留空 | failed 状态 TTL，默认 1800 秒。 |

### 6.2 Secret

| 变量名 | 是否必需 | 放哪边 | 说明 |
| --- | --- | --- | --- |
| `RENDERER_SHARED_TOKEN` | 完整模式强烈建议 | Worker 和渲染器两边都要有 | Worker 调用 Hugging Face 渲染器时的鉴权 token。两边必须一致。 |
| `RENDER_CALLBACK_TOKEN` | 完整模式强烈建议 | 只需要 Worker 这一边有 | 渲染器回调 Worker 时使用的鉴权 token。这个值不需要单独填到 Hugging Face 环境变量里。 |

说明：

- `RENDERER_SHARED_TOKEN` 是 Worker 发请求给渲染器时带上的 Bearer token。
- `RENDER_CALLBACK_TOKEN` 是 Worker 在下发渲染任务时一并告诉渲染器的，渲染器回调时会带回来。
- 因此，Hugging Face 渲染器侧必须配置 `RENDERER_SHARED_TOKEN`，但不需要额外配置 `RENDER_CALLBACK_TOKEN`。
- 如果你没有设置 `keep_vars = true`，并且仓库里还保留了 `[vars]`，那下次 Git 部署时，Dashboard 里的文本变量可能会被仓库配置覆盖。

## 第 7 步：首次部署后的检查

建议至少检查这几项：

### 7.1 SVG 基础功能

```text
/badge.svg?invite=<编码后的QQ群邀请链接>
```

正常时应该返回：

```text
content-type: image/svg+xml; charset=utf-8
```

如果你已经绑定了 `RENDER_BUCKET`，再多看一个响应头：

```text
x-svg-cache: miss | hit | stale
```

含义：

- `miss`：这次是现抓现生后写入缓存
- `hit`：直接命中 R2 SVG 缓存
- `stale`：先返回旧 SVG，同时后台刷新

### 7.2 抓取是否正常

```text
/api/group.json?invite=<编码后的QQ群邀请链接>
```

如果这里拿不到群信息，说明问题不在模板，而在抓取。

### 7.3 模板编译是否正常

```text
/api/template.json?invite=<编码后的QQ群邀请链接>&template=<编码后的模板链接>
```

这里可以看：

- `used_variables`
- `unresolved_variables`
- `variables`

### 7.4 完整模式是否正常

如果你启用了渲染器，再测：

```text
/badge.webp?invite=<编码后的QQ群邀请链接>&template=<编码后的HTML模板链接>&width=1000&height=500
```

第一次请求可能先返回占位 SVG，后台渲染完成后再返回正式图片。

## 第 8 步：常见坑

### 1. 直接拿上游仓库里的 KV id 去部署

这是最常见的问题。

`wrangler.toml` 里的 KV id 是账号级资源，不是“项目通用配置”。你 fork 之后必须换成自己的。

### 2. Worker 名字不一致

Cloudflare Dashboard 里创建的 Worker 名字，必须和 `wrangler.toml` 里的：

```toml
name = "..."
```

完全一致。

### 3. 你想用 Dashboard 绑定，但 fork 里还留着上游绑定配置

这是完整模式里最容易忽略的问题。

如果你打算在 Cloudflare Web 里创建并绑定自己的 KV / R2，建议先把 fork 里的旧 `[[kv_namespaces]]` / `[[r2_buckets]]` 删除，或者换成你自己的资源配置。

### 4. Dashboard 变量配好了，但下次部署又被覆盖

通常是因为：

- 你的 fork 里还保留了 `[vars]`
- 并且没有设置 `keep_vars = true`

### 5. R2 lifecycle 没配

不配也能跑，但 R2 里的历史渲染图会一直堆着，迟早要自己手动清理。

### 6. `RENDERER_SHARED_TOKEN` 两边不一致

完整模式里，如果 Worker 和 Hugging Face 渲染器上的 `RENDERER_SHARED_TOKEN` 不一致，Worker 发任务会失败。

## 推荐的最小上线组合

如果你只是想先把服务跑起来，建议按下面两档选：

### 最简单上线

- 只部署 Worker
- 只启用 `/badge.svg`
- 不在仓库里配 KV / R2
- 不在 Dashboard 里配 KV / R2
- 不配 Hugging Face 渲染器

### 完整上线

- Worker
- Dashboard 里绑定 KV
- Dashboard 里绑定 R2
- R2 lifecycle rule
- `SVG_CACHE_SOFT_TTL_SECONDS`
- `SVG_CACHE_HARD_TTL_SECONDS`
- Hugging Face 渲染器
- `RENDERER_SHARED_TOKEN`
- `RENDER_CALLBACK_TOKEN`

## 官方参考

- Cloudflare Workers Builds:
  https://developers.cloudflare.com/workers/ci-cd/builds/
- Cloudflare Workers environment variables:
  https://developers.cloudflare.com/workers/configuration/environment-variables/
- Cloudflare R2 object lifecycles:
  https://developers.cloudflare.com/r2/buckets/object-lifecycles/
