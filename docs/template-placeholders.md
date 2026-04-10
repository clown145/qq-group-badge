# 模板占位符

模板使用 `{{placeholder}}` 语法。SVG 徽章模板和 HTML 渲染模板共用同一套占位符系统。

Worker 会根据 QQ 群邀请链接获取群资料，生成模板变量，然后替换模板中的占位符。

## 语法

转义输出：

```text
{{group_name}}
```

这是最常用的写法。特殊字符会被转义，适合文本节点和大部分 SVG / HTML 属性。

原样输出：

```text
{{raw:group_name}}
{{{group_name}}}
```

只有在确认上下文安全时才使用原样输出。

JSON 输出：

```text
{{json:member_avatar_urls}}
```

适合在 HTML 模板中把变量写入 JavaScript 或 JSON 数据块。

## 变量列表

| 变量 | 类型 | 说明 |
| --- | --- | --- |
| `group_name` | string | QQ 群名称。 |
| `group_code` | string | QQ 群号。 |
| `group_id` | string | `group_code` 的别名。 |
| `member_count` | number 或 null | 群人数。 |
| `member_count_text` | string | 群人数文本；缺失时为空字符串。 |
| `avatar_url` | string | 群头像原始 URL。 |
| `avatar_data_url` | string | base64 头像。`/badge.svg` 会在 SVG 模板使用该变量时自动填充。 |
| `member_avatar_urls` | string[] | 邀请页中展示的成员头像 URL。 |
| `member_avatar_urls_csv` | string | 用英文逗号拼接的成员头像 URL。 |
| `member_avatar_count` | number | 当前抓取到的成员头像数量。 |
| `invite_url` | string | 用户传入的原始邀请链接。 |
| `resolved_invite_url` | string | 跟随 QQ 跳转后的最终页面 URL。 |
| `invite_title` | string | 邀请页标题。 |
| `invite_subtitle` | string | 邀请页副标题。 |
| `created_at_unix` | number 或 null | 群创建时间戳；页面提供时才有值。 |
| `created_at_iso` | string | 群创建时间的 ISO 格式；页面提供时才有值。 |
| `fetched_at` | string | Worker 抓取邀请页的时间。 |
| `fetched_at_unix` | number 或 null | Worker 抓取时间戳。 |

## SVG 示例

群名称：

```svg
<text x="88" y="58">{{group_name}}</text>
```

群号和人数：

```svg
<text x="88" y="82">群号 {{group_code}} · {{member_count_text}} members</text>
```

头像：

```svg
<image href="{{avatar_data_url}}" x="23" y="23" width="50" height="50" />
```

README 徽章建议使用 `avatar_data_url`，不要优先使用 `avatar_url`。内联头像更稳定，不需要最终 SVG 再加载外部图片。

## HTML 示例

头像图片：

```html
<img src="{{avatar_url}}" alt="{{group_name}}">
```

邀请链接：

```html
<a href="{{invite_url}}">加入 {{group_name}}</a>
```

内联数据：

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

## 未解析变量

如果模板使用了不存在的变量，Worker 不会删除它，而是保留原始占位符。

示例：

```text
{{unknown_variable}}
```

未解析变量会出现在 `/api/template.json` 的 `unresolved_variables` 字段中，便于排查模板拼写错误。

## 调试接口

查看群资料：

```text
/api/group.json?invite=<编码后的邀请链接>
```

查看模板编译结果：

```text
/api/template.json?invite=<编码后的邀请链接>&template=<编码后的模板链接>
```

返回内容包含：

- `template_sha256`
- `compiled_sha256`
- `used_variables`
- `unresolved_variables`
- `variables`

建议在把复杂模板放进 README 前，先用这个接口检查一次。

## 注意事项

- SVG 模板由 `/badge.svg` 直接返回。
- HTML 模板用于 `/badge.png`、`/badge.webp`、`/preview.html` 和外部渲染器。
- `avatar_data_url` 主要用于 README 安全的 SVG 头像，只会在 `/badge.svg` 模板入口自动填充。
