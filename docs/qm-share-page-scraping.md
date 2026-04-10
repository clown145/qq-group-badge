# QQ 群邀请页抓取说明

更新时间：2026-04-10

目标页面样例：

- 短链接：`https://qm.qq.com/q/oTzIrdDBIc`
- `curl -L` 后实际落地页：`https://qun.qq.com/universal-share/share?...`

## 结论

这个页面是一个 SSR 的 Nuxt 页面，核心群资料已经直接出现在首屏 HTML 里，不需要执行前端 JS 才能拿到。

对 Worker 来说，推荐按下面顺序抓取：

1. 先请求用户给的短链接，允许跟随 302 跳转。
2. 优先从 `script#__NUXT_DATA__` 里提取数据。
3. 如果脚本结构变了，再回退到可见 DOM 选择器。

`BeautifulSoup` 可以做这件事，但后续 Worker 实现里更适合：

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
- `base_info.groupinfo.createtime`
- `card_info.title`
- `card_info.subtitle`
- `asset_info.resource_infos`
- `member_info.member_tags`

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
      "createtime": 1763480103
    }
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

## 建议的标准化输出

Worker 侧建议先统一成这个内部结构，再去渲染 SVG 或传给后续 PNG / WebP 渲染器：

```json
{
  "source_url": "https://qm.qq.com/q/oTzIrdDBIc",
  "resolved_url": "https://qun.qq.com/universal-share/share?...",
  "group_name": "五彩斑斓的Bug群",
  "group_code": "903986711",
  "member_count": 76,
  "avatar_url": "https://p.qlogo.cn/gh/903986711/903986711/",
  "member_avatar_urls": [
    "http://qh.qlogo.cn/g?...",
    "http://qh.qlogo.cn/g?...",
    "http://qh.qlogo.cn/g?..."
  ],
  "invite_title": "邀请你加入群聊",
  "invite_subtitle": "邀请你加入QQ群聊五彩斑斓的Bug群，点击可查看详情",
  "created_at": 1763480103,
  "fetched_at": "2026-04-10T00:00:00Z"
}
```

## 清洗规则

- `member_count`：从 `.member-count` 文本中提取纯数字
- `group_code`：从 `.normal-code` 文本中提取纯数字
- `avatar_url`：优先用 `img.avatar[src]`
- `member_avatar_urls`：如果 DOM 只有前 3 个头像，接受它只是预览，不要把它当完整成员列表
- `resolved_url`：使用跟随跳转后的最终 URL
- `source_url`：保留用户原始短链接，后续 README 徽章超链接建议默认指向这个地址

## 当前不建议依赖的点

- `.q-qrcode` 的 `background-image`
  当前 PC 页里这个值是空的，不能作为二维码图片来源
- `.copy-btn`
  只是 UI 操作，没有额外数据
- `HEAD`
  页面对 `HEAD` 返回 `405`，健康检查不要这么做

## 对后续 Worker 的直接意义

后面实现 Worker 时，可以先只支持这几个字段：

- `group_name`
- `group_code`
- `member_count`
- `avatar_url`
- `member_avatar_urls`
- `source_url`
- `resolved_url`

这已经足够先把 README SVG 徽章做出来。PNG / WebP 模板渲染时，再把同一份标准化数据传给外部渲染服务即可。
