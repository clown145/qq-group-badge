# SVG 模板徽章

SVG 模板徽章适合放在 GitHub README 中。Worker 会拉取公开 SVG 模板，将 QQ 群资料注入占位符，然后直接返回 `image/svg+xml`。

这个流程不依赖外部渲染器，因此比 PNG / WebP 渲染更快，也不会出现“图片还在渲染中”的等待状态。

## 适用场景

推荐使用 SVG 模板徽章的场景：

- 想在 README 中展示 QQ 群名、群号、人数和头像。
- 想自定义徽章样式，但不需要复杂 HTML 渲染。
- 希望图片请求能立即返回。
- 希望尝试轻量 SVG 动画。

如果需要复杂网页布局、截图式效果或稳定动图，建议使用 `/badge.webp` 渲染 animated WebP。

## 在线生成

打开生成器：

[https://qq-group-badge.ciallo.de5.net/](https://qq-group-badge.ciallo.de5.net/)

操作步骤：

1. 输入 QQ 群邀请链接。
2. 选择静态模板、动画模板或自定义 URL。
3. 点击生成代码。
4. 复制 Markdown 或 HTML。
5. 点击测试预览，确认图片能正常返回。

## 手动使用

接口：

```text
GET /badge.svg?invite=<QQ群邀请链接>&template=<SVG模板URL>
```

Markdown 示例：

```md
[![QQ 群徽章](https://qq-group-badge.ciallo.de5.net/badge.svg?invite=https%3A%2F%2Fqm.qq.com%2Fq%2FknESGpUcdU&template=https%3A%2F%2Fraw.githubusercontent.com%2Fclown145%2Fqq-group-badge%2Fmain%2Fexamples%2Fgroup-badge-template.svg)](https://qm.qq.com/q/knESGpUcdU)
```

## 内置模板

| 模板 | 说明 | 原始地址 |
| --- | --- | --- |
| 静态 SVG | 推荐用于 README 的稳定模板。 | `https://raw.githubusercontent.com/clown145/qq-group-badge/main/examples/group-badge-template.svg` |
| 动画 SVG | 使用纯 SVG / CSS 动画，适合浏览器测试。 | `https://raw.githubusercontent.com/clown145/qq-group-badge/main/examples/group-animated-badge-template.svg` |

## 自定义模板要求

模板必须满足：

- 使用公开可访问的 HTTP / HTTPS URL。
- URL 直接返回 SVG 原文。
- 编译后包含有效的 `<svg>` 文档。
- 不包含 `<script>` 标签。
- 不包含 `onload=`、`onclick=` 等内联事件属性。

如果模板放在 GitHub，请使用 raw 链接：

```text
https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>/template.svg
```

不要使用 GitHub 页面链接：

```text
https://github.com/<owner>/<repo>/blob/<branch>/<path>/template.svg
```

## 最小模板

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="430" height="96" viewBox="0 0 430 96" role="img" aria-labelledby="title desc">
  <title id="title">{{group_name}}</title>
  <desc id="desc">{{group_code}} · {{member_count_text}} members</desc>

  <rect width="430" height="96" rx="18" fill="#14342b" />
  <circle cx="48" cy="48" r="25" fill="#ffffff" fill-opacity="0.18" />
  <image href="{{avatar_data_url}}" x="23" y="23" width="50" height="50" preserveAspectRatio="xMidYMid slice" />

  <text x="88" y="38" font-family="Verdana, DejaVu Sans, sans-serif" font-size="12" font-weight="700" fill="#f7ebc4">QQ GROUP</text>
  <text x="88" y="62" font-family="Verdana, DejaVu Sans, sans-serif" font-size="21" font-weight="700" fill="#ffffff">{{group_name}}</text>
  <text x="88" y="82" font-family="Verdana, DejaVu Sans, sans-serif" font-size="11" font-weight="700" fill="#fff8dd">群号 {{group_code}} · {{member_count_text}} members</text>
</svg>
```

## 常用占位符

| 占位符 | 说明 |
| --- | --- |
| `{{group_name}}` | 群名称。 |
| `{{group_code}}` | 群号。 |
| `{{member_count_text}}` | 群人数文本。 |
| `{{avatar_data_url}}` | base64 头像，推荐用于 SVG。 |
| `{{group_level_badge}}` | 群等级文本，例如 `LV4`。 |
| `{{group_tags_text}}` | 群标签文本。 |
| `{{group_file_count_text}}` | 群文件数量。 |
| `{{group_album_count_text}}` | 群相册数量。 |
| `{{group_essence_count_text}}` | 群精华数量。 |
| `{{member_distribution_text}}` | 成员分布摘要。 |
| `{{group_background_url}}` | 群背景图 URL。 |
| `{{group_background_data_url}}` | base64 群背景图，推荐用于 SVG。 |
| `{{invite_url}}` | 原始邀请链接。 |

完整列表见 [模板占位符](template-placeholders.md)。

## 头像处理

SVG 模板中推荐使用 `{{avatar_data_url}}`：

```svg
<image href="{{avatar_data_url}}" x="23" y="23" width="50" height="50" />
```

原因是 GitHub 和图片代理可能会阻止 SVG 内部继续加载外部图片。使用 `avatar_data_url` 后，头像会以内联 base64 的形式写入最终 SVG，更适合 README。

Worker 只会在模板中出现 `avatar_data_url` 时抓取并内联头像。不使用头像的模板不会额外请求头像资源。

禁用头像：

```text
/badge.svg?invite=<QQ群链接>&template=<SVG模板链接>&avatar=0
```

如果模板使用了 `{{group_background_data_url}}`，但你不想内联背景图，可以加：

```text
/badge.svg?invite=<QQ群链接>&template=<SVG模板链接>&background=0
```

## 动画支持

SVG 支持 CSS animation 和 SMIL animation。项目内置的动画模板使用 CSS `@keyframes`，不需要 JavaScript。

需要注意：浏览器通常能播放 SVG 动画，但 GitHub README、CDN 或图片代理可能会限制、缓存或冻结动画。如果动图效果必须稳定，建议使用 `/badge.webp` 生成 animated WebP。

## 缓存刷新

SVG 徽章响应头：

```text
cache-control: public, max-age=300, s-maxage=300, stale-while-revalidate=3600
```

如果更新模板后仍看到旧图，可以添加版本参数：

```text
&v=20260411
```

`v` 只是用于改变 URL，任意值都可以。

## 排查问题

徽章无法显示时，按下面顺序检查：

1. 在浏览器中直接打开生成的图片 URL。
2. 确认响应头是 `image/svg+xml; charset=utf-8`。
3. 确认模板 URL 是 raw SVG URL，不是 GitHub `blob` 页面。
4. 添加 `&v=<新值>` 绕过缓存。
5. 使用 `/api/group.json?invite=<编码后的邀请链接>` 检查群信息是否能抓取。
6. 使用 `/api/template.json?invite=<编码后的邀请链接>&template=<编码后的模板链接>` 检查变量和未解析占位符。

正常响应示例：

```text
HTTP/2 200
content-type: image/svg+xml; charset=utf-8
```

## 安全限制

Worker 会拒绝以下模板：

- 包含 `<script>` 标签。
- 包含 `onload=`、`onclick=` 等内联事件属性。
- 编译后不包含 `<svg>` 文档。

这些限制用于避免把不安全内容作为可嵌入图片返回。
