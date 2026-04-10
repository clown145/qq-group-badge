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

### 基础信息

| 变量 | 类型 | 说明 |
| --- | --- | --- |
| `group_name` | string | QQ 群名称。 |
| `group_code` | string | QQ 群号。 |
| `group_id` | string | `group_code` 的别名。 |
| `member_count` | number 或 null | 群人数。 |
| `member_count_text` | string | 群人数文本；缺失时为空字符串。 |
| `group_description` | string | 群简介；缺失时为空字符串。 |

### 图片

图片 URL 占位符会直接输出远程图片地址。对应的 `*_data_url` 占位符会输出 `data:image/...;base64,...`，更适合 README 中的 SVG 图片。

`/badge.svg` 只会在 SVG 模板实际引用对应 `*_data_url` 变量时下载并内联图片，避免无意义地增加 Worker 请求。`avatar_data_url` 可用 `avatar=0` 禁用，背景图 data URL 可用 `background=0` 禁用。

| 变量 | 类型 | 说明 |
| --- | --- | --- |
| `avatar_url` | string | 群头像 URL。 |
| `avatar_data_url` | string | base64 群头像。 |
| `group_background_url` | string | 第一张群背景图 URL。 |
| `group_background_data_url` | string | 第一张群背景图的 base64 data URL。 |
| `group_background_urls` | string[] | 群背景图 URL 列表。 |
| `group_background_urls_csv` | string | 用英文逗号拼接的群背景图 URL。 |
| `group_background_data_urls` | string[] | 群背景图 base64 data URL 列表。 |
| `group_background_data_urls_csv` | string | 用英文逗号拼接的群背景图 base64 data URL。 |
| `group_background_count` | number | 群背景图数量。 |
| `group_background_1_url` | string | 第 1 张群背景图 URL。 |
| `group_background_1_data_url` | string | 第 1 张群背景图 base64 data URL。 |
| `group_background_2_url` | string | 第 2 张群背景图 URL。 |
| `group_background_2_data_url` | string | 第 2 张群背景图 base64 data URL。 |
| `group_background_3_url` | string | 第 3 张群背景图 URL。 |
| `group_background_3_data_url` | string | 第 3 张群背景图 base64 data URL。 |
| `member_avatar_urls` | string[] | 邀请页中展示的成员头像 URL 列表。 |
| `member_avatar_urls_csv` | string | 用英文逗号拼接的成员头像 URL。 |
| `member_avatar_data_urls` | string[] | 成员头像 base64 data URL 列表。 |
| `member_avatar_data_urls_csv` | string | 用英文逗号拼接的成员头像 base64 data URL。 |
| `member_avatar_count` | number | 当前抓取到的成员头像数量。 |
| `member_avatar_1_url` | string | 第 1 个成员头像 URL。 |
| `member_avatar_1_data_url` | string | 第 1 个成员头像 base64 data URL。 |
| `member_avatar_2_url` | string | 第 2 个成员头像 URL。 |
| `member_avatar_2_data_url` | string | 第 2 个成员头像 base64 data URL。 |
| `member_avatar_3_url` | string | 第 3 个成员头像 URL。 |
| `member_avatar_3_data_url` | string | 第 3 个成员头像 base64 data URL。 |
| `group_asset_icon_urls` | string[] | 群资产图标 URL 列表。 |
| `group_asset_icon_urls_csv` | string | 用英文逗号拼接的群资产图标 URL。 |
| `group_asset_icon_data_urls` | string[] | 群资产图标 base64 data URL 列表。 |
| `group_asset_icon_data_urls_csv` | string | 用英文逗号拼接的群资产图标 base64 data URL。 |
| `group_assets_with_icon_data_urls` | object[] | 群资产列表，额外包含 `iconDataUrl` 字段。 |
| `group_file_icon_url` | string | 群文件图标 URL。 |
| `group_file_icon_data_url` | string | 群文件图标 base64 data URL。 |
| `group_album_icon_url` | string | 群相册图标 URL。 |
| `group_album_icon_data_url` | string | 群相册图标 base64 data URL。 |
| `group_essence_icon_url` | string | 群精华图标 URL。 |
| `group_essence_icon_data_url` | string | 群精华图标 base64 data URL。 |

数组或对象变量建议使用 `{{json:变量名}}` 输出，例如 `{{json:member_avatar_data_urls}}`。

### 标签与等级

| 变量 | 类型 | 说明 |
| --- | --- | --- |
| `group_level` | number 或 null | 群等级数字；缺失时为 `null`。 |
| `group_level_text` | string | 群等级文本，例如 `4`；缺失时为空字符串。 |
| `group_level_badge` | string | 群等级徽标文本，例如 `LV4`；缺失时为空字符串。 |
| `group_tags` | string[] | 群标签列表。 |
| `group_tags_csv` | string | 用英文逗号拼接的群标签。 |
| `group_tags_text` | string | 用 ` · ` 拼接的群标签，适合直接显示。 |
| `group_tag_count` | number | 群标签数量。 |
| `group_tag_1` | string | 第 1 个群标签；缺失时为空字符串。 |
| `group_tag_2` | string | 第 2 个群标签；缺失时为空字符串。 |
| `group_tag_3` | string | 第 3 个群标签；缺失时为空字符串。 |

### 群资产

| 变量 | 类型 | 说明 |
| --- | --- | --- |
| `group_assets` | object[] | 群资产列表，适合配合 `{{json:group_assets}}` 使用。 |
| `group_assets_text` | string | 群资产摘要，例如 `群文件 131项 · 群相册 172项`。 |
| `group_asset_count` | number | 群资产条目数量。 |
| `group_file_count` | number 或 null | 群文件数量；缺失时为 `null`。 |
| `group_file_count_text` | string | 群文件数量文本；缺失时为空字符串。 |
| `group_file_unit` | string | 群文件单位，通常是 `项`。 |
| `group_album_count` | number 或 null | 群相册数量；缺失时为 `null`。 |
| `group_album_count_text` | string | 群相册数量文本；缺失时为空字符串。 |
| `group_album_unit` | string | 群相册单位，通常是 `项`。 |
| `group_essence_count` | number 或 null | 群精华数量；缺失时为 `null`。 |
| `group_essence_count_text` | string | 群精华数量文本；缺失时为空字符串。 |
| `group_essence_unit` | string | 群精华单位，通常是 `条`。 |
| `group_relation_count` | number 或 null | 页面提供的群关联数量；缺失时为 `null`。 |
| `group_relation_count_text` | string | 群关联数量文本；缺失时为空字符串。 |

### 成员分布

| 变量 | 类型 | 说明 |
| --- | --- | --- |
| `member_distribution` | object[] | 成员分布列表，适合配合 `{{json:member_distribution}}` 使用。 |
| `member_distribution_text` | string | 成员分布摘要，例如 `19% 女生 共42人 · 北京 共3人`。 |
| `member_distribution_count` | number | 成员分布条目数量。 |
| `member_distribution_titles` | string[] | 成员分布标题列表。 |
| `member_distribution_titles_csv` | string | 用英文逗号拼接的成员分布标题。 |

### 邀请与时间

| 变量 | 类型 | 说明 |
| --- | --- | --- |
| `invite_url` | string | 用户传入的原始邀请链接。 |
| `resolved_invite_url` | string | 跟随 QQ 跳转后的最终页面 URL。 |
| `invite_title` | string | 邀请页标题。 |
| `invite_subtitle` | string | 邀请页副标题。 |
| `created_at_unix` | number 或 null | 群创建时间戳，单位为秒；页面提供时才有值。 |
| `created_at_iso` | string | 群创建时间的 ISO 格式；缺失时为空字符串。 |
| `created_at_date` | string | 群创建日期，例如 `2021-08-16`；缺失时为空字符串。 |
| `created_at_text` | string | 适合直接显示的建群日期，目前等同于 `created_at_date`。 |
| `fetched_at` | string | Worker 抓取邀请页的时间。 |
| `fetched_at_unix` | number 或 null | Worker 抓取时间戳，单位为秒。 |

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

等级和标签：

```svg
<text x="88" y="34">{{group_level_badge}} · {{group_tags_text}}</text>
```

群资产：

```svg
<text x="88" y="82">文件 {{group_file_count_text}}{{group_file_unit}} · 相册 {{group_album_count_text}}{{group_album_unit}} · 精华 {{group_essence_count_text}}{{group_essence_unit}}</text>
```

背景图：

```svg
<image href="{{group_background_data_url}}" width="430" height="96" preserveAspectRatio="xMidYMid slice" />
```

群资产图标：

```svg
<image href="{{group_file_icon_data_url}}" x="88" y="68" width="14" height="14" />
```

建群日期：

```svg
<text x="88" y="82">建群 {{created_at_text}}</text>
```

成员分布摘要：

```svg
<text x="20" y="90">{{member_distribution_text}}</text>
```

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
    tags: {{json:group_tags}},
    avatars: {{json:member_avatar_urls}},
    assets: {{json:group_assets}},
    distribution: {{json:member_distribution}}
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
- `*_data_url` 图片占位符主要用于 README 安全的 SVG 图片，只会在 `/badge.svg` 模板入口按需自动填充。
- QQ 页面不会保证每个群都有标签、等级、群资产、成员分布或背景图。缺失字段会返回空字符串、空数组或 `null`。
