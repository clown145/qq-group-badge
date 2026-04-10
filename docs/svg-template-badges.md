# SVG 模板徽章使用说明

更新时间：2026-04-10

SVG 模板徽章适合 README。Worker 会拉取一个公开 SVG 模板，把 QQ 群资料填入占位符，然后直接返回 `image/svg+xml`。这个流程不经过 Hugging Face 渲染器，所以比 PNG / WebP 模板渲染快，也不会出现“图片还没渲染好”的等待状态。

## 基本用法

入口：

```text
GET /badge.svg?invite=<QQ群邀请链接>&template=<SVG模板URL>
```

README 写法：

```md
[![QQ群徽章](https://qq-group-badge.ciallo.de5.net/badge.svg?invite=https%3A%2F%2Fqm.qq.com%2Fq%2FknESGpUcdU&template=https%3A%2F%2Fraw.githubusercontent.com%2Fclown145%2Fqq-group-badge%2Fmain%2Fexamples%2Fgroup-badge-template.svg)](https://qm.qq.com/q/knESGpUcdU)
```

如果你刚改了模板但 GitHub 或 Cloudflare 还在用旧缓存，可以给图片 URL 加一个版本参数：

```text
&v=20260410
```

`v` 不参与业务逻辑，只是改变 URL 用来绕过缓存。

## 模板 URL

`template` 必须是 Worker 能直接访问的 HTTP / HTTPS URL。常用做法是把 SVG 模板放到 GitHub 仓库，然后使用 `raw.githubusercontent.com` 链接。

示例模板：

```text
https://raw.githubusercontent.com/clown145/qq-group-badge/main/examples/group-badge-template.svg
```

模板文件必须直接返回 SVG 内容，不要使用 GitHub 普通页面链接，例如不要用 `https://github.com/.../blob/...`。

## 最小模板

一个最小可用 SVG 模板如下：

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

项目里已经有一个完整示例：

```text
examples/group-badge-template.svg
```

## 占位符

SVG 模板和 HTML 模板使用同一套占位符语法：

```text
{{group_name}}
{{raw:group_name}}
{{json:member_avatar_urls}}
{{{group_name}}}
```

SVG 里一般用默认写法 `{{group_name}}`，Worker 会做 XML 转义，避免群名里的特殊字符破坏 SVG。

常用变量：

| 变量 | 说明 |
| --- | --- |
| `group_name` | 群名称 |
| `group_code` | 群号 |
| `group_id` | 群号别名，等同于 `group_code` |
| `member_count` | 群人数，数字或 `null` |
| `member_count_text` | 群人数文本，缺失时为空字符串 |
| `avatar_url` | 群头像原始 URL |
| `avatar_data_url` | 群头像 base64 data URL，推荐在 SVG 里使用 |
| `invite_url` | 用户传入的邀请链接 |
| `resolved_invite_url` | 跳转后的最终邀请页 URL |

完整变量表见：

```text
docs/template-placeholders.md
```

## 头像

GitHub README 对 SVG 内部的外链图片支持不稳定，所以 SVG 模板里不要优先使用 `{{avatar_url}}`。推荐使用：

```svg
<image href="{{avatar_data_url}}" x="23" y="23" width="50" height="50" />
```

Worker 只在 SVG 模板内容里出现 `avatar_data_url` 时才会抓头像并转成 base64，这样不用头像的模板不会额外消耗一次头像请求。

如果想禁用头像嵌入，可以加：

```text
avatar=0
```

示例：

```text
/badge.svg?invite=<QQ群链接>&template=<SVG模板链接>&avatar=0
```

## 响应和 GitHub 兼容性

SVG 模板徽章返回：

```text
content-type: image/svg+xml; charset=utf-8
```

同时支持 `HEAD`。GitHub 读取 README 图片时可以正常识别这是图片，而不是普通文本。

README 里应使用 `/badge.svg`。不要把 `/badge.webp` 的临时 SVG fallback 当成最终 README 方案，因为扩展名是 `.webp` 时，部分平台会按 WebP 处理，不一定接受 SVG body。

## 缓存

SVG 模板徽章的响应头当前是：

```text
cache-control: public, max-age=300, s-maxage=300, stale-while-revalidate=3600
```

这意味着群人数、模板内容或头像变化后，可能会有短时间缓存。需要立即刷新时，给 URL 加版本参数即可：

```text
&v=2
```

## 调试

检查群资料：

```text
/api/group.json?invite=<QQ群链接>
```

检查模板占位符和 hash：

```text
/api/template.json?invite=<QQ群链接>&template=<模板链接>
```

注意：`/api/template.json` 只做普通模板编译，用来检查变量是否存在；`avatar_data_url` 的实际 base64 注入只在 `/badge.svg?template=...` 入口里发生。

检查最终 SVG 响应头：

```bash
curl -I "https://qq-group-badge.ciallo.de5.net/badge.svg?invite=<编码后的QQ群链接>&template=<编码后的SVG模板链接>"
```

应该看到：

```text
HTTP/2 200
content-type: image/svg+xml; charset=utf-8
```

## 模板限制

为了避免把不安全内容直接作为图片返回，Worker 会做几个基础检查：

- 模板编译后必须包含 `<svg>`。
- 模板不能包含 `<script>`。
- 模板不能包含 `onclick=`、`onload=` 这类内联事件属性。

如果模板不符合要求，Worker 会返回错误 JSON。README 中引用图片时看不到 JSON 内容，调试时建议先在浏览器或 `curl` 里打开图片 URL。

