# 模板占位符说明

更新时间：2026-04-10

这个项目现在已经支持 Worker 侧模板编译。流程是：

1. Worker 拉取远程 HTML 模板
2. Worker 把群资料注入占位符
3. Worker 对编译后的 HTML 计算 `compiled_sha256`
4. Worker 用 `compiled_sha256 + 输出参数 + cache version` 计算 `render_key`

后面的 HF 渲染器应该直接接收这份“已编译模板”，不要再自己重复取群信息。

## 占位符语法

支持 3 种形式：

- `{{group_name}}`
  默认模式，HTML 转义后输出
- `{{raw:group_name}}`
  原样输出，不做 HTML 转义
- `{{json:member_avatar_urls}}`
  以 JSON 字面量输出，适合内联到 `<script>` 中

另外，`{{{group_name}}}` 也等价于 `{{raw:group_name}}`。

## 当前支持的变量

| 变量名 | 类型 | 示例值 | 说明 |
| --- | --- | --- | --- |
| `group_name` | string | `五彩斑斓的Bug群` | 群名称 |
| `group_code` | string | `903986711` | 群号 |
| `group_id` | string | `903986711` | `group_code` 的别名 |
| `member_count` | number \| null | `76` | 群人数，缺失时为 `null` |
| `member_count_text` | string | `76` | 群人数的文本版 |
| `avatar_url` | string | `https://p.qlogo.cn/...` | 群头像 |
| `member_avatar_urls` | string[] | `["https://qh.qlogo.cn/...", "..."]` | 页面里预览到的成员头像列表 |
| `member_avatar_urls_csv` | string | `https://...,...` | 头像列表 CSV 版 |
| `member_avatar_count` | number | `3` | 当前抓到的成员头像数 |
| `invite_url` | string | `https://qm.qq.com/q/oTzIrdDBIc` | 用户原始邀请链接 |
| `resolved_invite_url` | string | `https://qun.qq.com/universal-share/share?...` | 跟随跳转后的最终链接 |
| `invite_title` | string | `邀请你加入群聊` | 邀请标题 |
| `invite_subtitle` | string | `邀请你加入QQ群聊...` | 邀请副标题 |
| `created_at_unix` | number \| null | `1763480103` | 页面返回的创建时间戳 |
| `created_at_iso` | string | `2025-11-18T...Z` | ISO 时间 |
| `fetched_at` | string | `2026-04-10T05:15:59.467Z` | Worker 抓取时间 |
| `fetched_at_unix` | number \| null | `176...` | 抓取时间戳 |

## 推荐写法

### 文本节点

```html
<h1>{{group_name}}</h1>
<p>群号 {{group_code}}</p>
<p>人数 {{member_count_text}}</p>
```

### 属性值

```html
<img src="{{avatar_url}}" alt="{{group_name}}">
<a href="{{invite_url}}">加入群聊</a>
```

### 内联脚本

```html
<script>
  window.BADGE_DATA = {
    name: {{json:group_name}},
    code: {{json:group_code}},
    members: {{json:member_count}},
    avatars: {{json:member_avatar_urls}}
  };
</script>
```

## 变量缺失时的行为

如果模板里用了不存在的变量名：

- Worker 不会把它删掉
- 原始占位符会保留在编译后的 HTML 中
- 同时在 `/api/template.json` 和 `/api/render.json` 中出现在 `unresolved_variables`

这样方便你排模板错误。

## 调试入口

### 查看变量和 hash

```text
/api/template.json?invite=<QQ群链接>&template=<模板链接>
```

返回内容里有：

- `template_sha256`
- `compiled_sha256`
- `used_variables`
- `unresolved_variables`
- `variables`

### 查看编译后的 HTML

```text
/preview.html?invite=<QQ群链接>&template=<模板链接>
```

这个接口会自动插入 `<base href="模板URL">`，这样模板里的相对资源在预览时还能正常加载。

## `render_key` 的当前规则

Worker 现在按下面这组信息生成 `render_key`：

```json
{
  "cacheVersion": "v1",
  "compiledSha256": "<编译后 HTML 的 sha256>",
  "options": {
    "format": "png",
    "width": 1200,
    "height": 630,
    "fps": 12,
    "durationMs": 2400
  }
}
```

也就是说，只要这些东西不变：

- 模板内容不变
- 注入后的群数据不变
- 渲染参数不变

那后续外部渲染器就应该直接复用缓存结果。
