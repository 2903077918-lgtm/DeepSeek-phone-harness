# deepseekharness-relay · 手机控制台（web/index.html）

纯深色、对话式、移动优先的远程控制台 UI，设计风格对齐 DeepSeek 官方 App
（背景 `#0D0D0D`，品牌蓝紫 `#4D6BFE→#6C8CFF`，深灰气泡 `#262626`，圆角 12–16px，克制留白）。
自包含单文件：内联 CSS/JS、零外部依赖、UTF-8 无 BOM。后端 `src/transport-lan.js` 直接以
`GET /` 输出本文件（`text/html; charset=utf-8`），无需额外配置。

## 界面结构

- **顶部栏**：● 连接状态点（绿=已连接 / 红=断开或 Token 无效 / 灰=未设置）+ 应用名 + 当前会话名 + ☰ 面板按钮
- **对话区**：三层消息流
  - 用户消息：蓝紫渐变气泡，右对齐
  - 助手消息：深灰气泡，左对齐；stdout 以简单 Markdown 渲染（粗体 / 行内代码 / 代码块 / 列表 / 标题 / 引用 / 链接），stderr 单独标红
  - 工具卡片：⚙ 等宽字体的可折叠「执行详情」卡（exit code / backend / 原始 stdout+stderr）
  - 执行中：助手气泡内「正在执行…」呼吸灯三点动画 + 实时秒表；完成后显示 ✓/✗ 状态与耗时
- **底部输入栏**：胶囊输入框（16px 字号防 iOS 缩放）+ 蓝紫圆形发送按钮，safe-area 适配；Enter 发送、Shift+Enter 换行
- **☰ 抽屉**（底部滑出面板）：会话列表（标题 / 时间 / 消息数，点击切换，两步确认删除，+ 新会话）、全局执行记录（可展开 stdout/stderr，标注「后端未按会话隔离」）、连接与设置（Agent / 版本 / 心跳 / 队列 / 会话模式 / 令牌管理）

## 与后端 API 对接

| 前端行为 | 调用 |
| --- | --- |
| 心跳（8s 间隔） | `GET /api/status`（Bearer），更新状态点与设置页详情 |
| 发消息 | 确保会话存在 → `POST /api/exec` body `{task, sessionId}`（无超时，任务最长 10 分钟） |
| 全局记录 | `GET /api/history`，抽屉中展示，可手动刷新 |
| 会话探测 | 启动时 `GET /api/sessions`（4s 超时）探测后端是否支持会话；支持则发送前 `POST /api/sessions` 创建服务端会话并复用其 `sessionId` |
| 认证 | 所有 `/api/*` 自动携带 `Authorization: Bearer <token>`；token 存 `localStorage.ph_token`，首次使用弹窗引导输入 |

错误处理：401 → toast「令牌无效」+ 自动弹出令牌窗；网络失败 → 中文提示；空输入 → toast 拦截；执行中锁定输入（单飞）。

## 已知 API 缺口（实测 src/transport-lan.js v0.3.0）

1. **`GET /api/sessions` / `POST /api/sessions` 未实现**（返回 404）。前端已做能力探测：探测失败时自动回退为
   **本地会话模式**（会话与消息持久化在 localStorage），并在设置页标注「本地会话（后端暂无 /api/sessions）」，同时仍把 `sessionId`
   随 exec 请求体携带，便于后端将来支持时无缝切换。
2. **`/api/history` 为全局记录**：条目无 `sessionId` 字段，无法按会话过滤，且 exec 响应也不返回 `sessionId`。
   因此对话区的「会话历史」以本地消息为准（这是当前唯一正确的按会话历史来源），全局记录在抽屉中整体展示并明确标注。

## 验证

- `node --check`：提取内联 `<script>` 内容临时校验，通过。
- 文件为 UTF-8 无 BOM（后端以 `text/html; charset=utf-8` 输出）。
- 浏览器手工验证路径：无 token 首次弹窗 → 输入 token → 连接点变绿 → 发送任务 → 呼吸灯 → 结果气泡 + 工具卡片 → 新会话/切换/删除 → 抽屉全局记录 → 断网观察红色状态点。
- 调试：`window.__app` 暴露核心函数（sendMessage / switchSession / refreshStatus / api / renderMarkdown 等）。

## 本地预览（可选，仅开发用）

```powershell
python -m http.server 9000 --directory web
```

浏览器打开 `http://127.0.0.1:9000` 即可预览 UI（API 请求会失败属正常，需连接运行中的 Agent 才有数据）。
