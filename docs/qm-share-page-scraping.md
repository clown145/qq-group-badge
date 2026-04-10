# QQ 邀请页抓取说明

更新时间：2026-04-11

这份文档面向维护者，记录 QQ 邀请页当前可观察到的数据结构和字段提取策略。普通用户通常不需要阅读本页。

目标页面样例：

- 短链接：`https://qm.qq.com/q/oTzIrdDBIc`
- 富信息短链接：`https://qm.qq.com/q/OEu9ZX7uOi`
- `curl -L` 后实际落地页：`https://qun.qq.com/universal-share/share?...`

## 结论

这个页面是一个 SSR 的 Nuxt 页面，核心群资料已经直接出现在首屏 HTML 里，不需要执行前端 JS 才能拿到。

对 Worker 来说，推荐按下面顺序抓取：

1. 先请求用户给的短链接，允许跟随 302 跳转。
2. 优先从 `script#__NUXT_DATA__` 里提取数据。
3. 如果脚本结构变了，再回退到可见 DOM 选择器。

`BeautifulSoup` 可以完成这类提取。在 Cloudflare Worker 中，更适合使用：

- `HTMLRewriter` 读取可见 DOM
- 或直接对 HTML 字符串做少量正则提取

## 请求层观察

- `https://qm.qq.com/q/oTzIrdDBIc` 会跳转到 `https://qun.qq.com/universal-share/share?...`
- 直接用 `curl -L -A 'Mozilla/5.0'` 可以拿到完整 HTML
- 这个页面对 `HEAD` 返回 `405 Method Not Allowed`

实现时建议补一个浏览器风格 UA，至少不要用默认空 UA。

## 可见 DOM 字段映射

以下内容都直接出现在首屏 HTML 中，可用选择器提取。

| 数据 | 推荐选择器 | 标签示例 | 当前样例值 | 处理方式 |
| --- | --- | --- | --- | --- |
| 群头像 | `img.avatar` | `<img class="avatar" src="...">` | `https://p.qlogo.cn/gh/903986711/903986711/` | 直接读 `src` |
| 群名称 | `.group-name` | `<div class="group-name">五彩斑斓的Bug群</div>` | `五彩斑斓的Bug群` | 取文本 |
| 群成员头像列表 | `.member-avatars .member-avatar img` | `<div class="member-avatar"><img src="..."></div>` | 3 个头像 URL | 收集全部 `src` |
| 群人数 | `.member-count` | `<span class="member-count">76人·</span>` | `76人·` | 去掉非数字字符，得到 `76` |
| 群号 | `.normal-code` | `<span class="normal-code">群号: 903986711</span>` | `群号: 903986711` | 正则提取数字，得到 `903986711` |
| 群简介 | `.group-description__content` | `<span class="group-description__content">...</span>` | 群简介文本 | 取文本，去掉折叠按钮文本 |
| 群标签 | `.group-tag-item` | `<div class="group-tag-item">养生</div>` | 多个标签 | 收集文本，排除 `LV*` |
| 群等级 | `.group-tag-item` | `<div class="group-tag-item">LV4</div>` | `LV4` | 提取数字 `4` |
| 群背景图 | `.banner-item[style]` | `background-image:url(...)` | `https://p.qlogo.cn/gh/...` | 从 CSS url 中提取 |
| 复制按钮文本 | `.copy-text` | `<span class="copy-text">复制</span>` | `复制` | 无业务价值，可忽略 |
| 二维码入口图标 | `.qrcode-icon` | `<i class="q-icon qrcode-icon">...</i>` | 图标按钮 | 只是入口，不是数据 |

### 关键 DOM 片段

```html
<div class="avatar-wrapper">
  <img class="avatar" src="https://p.qlogo.cn/gh/903986711/903986711/">
</div>
<div class="text-info">
  <div class="name-row">
    <div class="group-name">五彩斑斓的Bug群</div>
  </div>
  <div class="detail-info">
    <div class="member-avatars">
      <div class="member-avatar"><img src="..."></div>
      <div class="member-avatar"><img src="..."></div>
      <div class="member-avatar"><img src="..."></div>
    </div>
    <span class="member-count">76人·</span>
    <span class="normal-code">群号: 903986711</span>
    <div class="copy-btn">...</div>
  </div>
</div>
```

## `__NUXT_DATA__` 兜底字段

页面底部存在：

```html
<script type="application/json" id="__NUXT_DATA__">...</script>
```

脚本内容里带有一段字符串化 JSON，里面已经包含同一批群资料。当前样例中可直接观察到这些键：

- `base_info.groupinfo.avatar`
- `base_info.groupinfo.name`
- `base_info.groupinfo.memberAvatars`
- `base_info.groupinfo.memberCnt`
- `base_info.groupinfo.groupcode`
- `base_info.groupinfo.description`
- `base_info.groupinfo.tags`
- `base_info.groupinfo.createtime`
- `base_info.group_level`
- `base_info.msg_head_portrait`
- `base_info.group_relation_num`
- `member_info.member_tags`
- `asset_info.resource_infos`
- `card_info.title`
- `card_info.subtitle`

当前页面中能看到的样例值：

```json
{
  "base_info": {
    "groupinfo": {
      "avatar": "https://p.qlogo.cn/gh/903986711/903986711/",
      "name": "五彩斑斓的Bug群",
      "memberAvatars": [
        "http://qh.qlogo.cn/g?...",
        "http://qh.qlogo.cn/g?...",
        "http://qh.qlogo.cn/g?..."
      ],
      "memberCnt": 76,
      "groupcode": "903986711",
      "description": "群简介",
      "tags": ["中医", "健康小常识"],
      "createtime": 1763480103
    }
  },
  "member_info": {
    "member_tags": [
      {
        "title": "19%",
        "icon": "female",
        "percentage": 19,
        "subtitle": [{ "item": "女生 共42人" }]
      }
    ]
  },
  "asset_info": {
    "resource_infos": [
      {
        "title": "群文件",
        "count": 131,
        "unit": "项"
      }
    ]
  },
  "card_info": {
    "title": "邀请你加入群聊",
    "subtitle": [
      {
        "item": "邀请你加入QQ群聊五彩斑斓的Bug群，点击可查看详情"
      }
    ]
  }
}
```

## DOM 与脚本的取舍

推荐优先级：

1. `__NUXT_DATA__` 中的结构化字段
2. 可见 DOM 标签

原因：

- DOM 文本会混进展示符号，比如 `76人·`
- 群号文本会带前缀，比如 `群号: `
- `data-v-*` 这类 Nuxt scoped 标记不稳定，不应该依赖
- 类名本身看起来比 `data-v-*` 更稳定，但仍可能改版
- `__NUXT_DATA__` 里能拿到更多字段，比如 `createtime`、资源统计、成员标签

## 标准化输出

Worker 会把页面字段整理为统一的数据结构，再交给 SVG 模板或 PNG / WebP 渲染流程使用：

```json
{
  "sourceUrl": "https://qm.qq.com/q/oTzIrdDBIc",
  "resolvedUrl": "https://qun.qq.com/universal-share/share?...",
  "groupName": "五彩斑斓的Bug群",
  "groupCode": "903986711",
  "memberCount": 76,
  "groupDescription": "群简介",
  "groupLevel": 4,
  "groupTags": ["中医", "健康小常识"],
  "avatarUrl": "https://p.qlogo.cn/gh/903986711/903986711/",
  "backgroundUrl": "https://p.qlogo.cn/gh/903986711/903986711_3/640",
  "memberAvatarUrls": [
    "http://qh.qlogo.cn/g?...",
    "http://qh.qlogo.cn/g?...",
    "http://qh.qlogo.cn/g?..."
  ],
  "memberDistribution": [],
  "assetInfos": [],
  "inviteTitle": "邀请你加入群聊",
  "inviteSubtitle": "邀请你加入QQ群聊五彩斑斓的Bug群，点击可查看详情",
  "createdAt": 1763480103,
  "fetchedAt": "2026-04-10T00:00:00Z"
}
```

## 清洗规则

- `memberCount`：从 `.member-count` 文本中提取纯数字
- `groupCode`：从 `.normal-code` 文本中提取纯数字
- `avatarUrl`：优先用 `img.avatar[src]`
- `memberAvatarUrls`：如果 DOM 只有前 3 个头像，接受它只是预览，不要把它当完整成员列表
- `resolvedUrl`：使用跟随跳转后的最终 URL
- `sourceUrl`：保留用户原始短链接，README 徽章超链接建议默认指向这个地址

## 当前不建议依赖的点

- `.q-qrcode` 的 `background-image`
  当前 PC 页里这个值是空的，不能作为二维码图片来源
- `.copy-btn`
  只是 UI 操作，没有额外数据
- `HEAD`
  页面对 `HEAD` 返回 `405`，健康检查不要这么做

## 最小字段集

徽章渲染至少需要以下字段：

- `groupName`
- `groupCode`
- `memberCount`
- `avatarUrl`
- `memberAvatarUrls`
- `sourceUrl`
- `resolvedUrl`

这些字段已经足够生成 README SVG 徽章。PNG / WebP 模板渲染会复用同一份标准化数据。
