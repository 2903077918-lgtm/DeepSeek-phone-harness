# deepseekharness-relay · 手机控制台（web/index.html v2）

纯深色、对话式、移动优先的远程控制台 UI v2，iOS 风格三层导航 + 流式输出。
自包含单文件：内联 CSS/JS、零外部依赖、UTF-8 无 BOM。后端 `src/transport-lan.js` 直接以
`GET /` 输出本文件（`text/html; charset=utf-8`），无需额外配置。

## 界面结构（iOS NavigationStack 三层）

- **层级 0 对话流（主界面）**：顶栏（连接点 + 品牌 + 待授权徽章 + ☰）+ **上下文条**
  （`项目名 › 会话标题` 面包屑，点击回项目列表）+ 三层气泡对话区 + 底部输入栏
- **层级 1 项目列表**（从左滑入）：搜索框、💼 DSH 工作区（/api/dsh-workspaces，含 sessionCount
  徽章弹跳）、📱 我的对话（本地会话）、🕘 全局记录（/api/history）、底部连接状态/版本/令牌管理
- **层级 2 会话列表**（点项目滑入）：该项目下的 DSH 会话（/api/dsh-sessions 按 cwd 前缀过滤），
  💬 标题 + cwd + 更新时间；点击 → 加载 /api/dsh-history 到对话流并支持「继续对话」
- **过渡动画**：push/pop 弹性 slide（cubic-bezier(0.32,0.72,0,1)）+ 下层轻微缩放/视差；
  左边缘右滑返回手势（拖拽实时视差、松手回弹/弹出）、顶栏 ← 按钮返回

## 与后端 API 对接

| 前端行为 | 调用 |
| --- | --- |
| 心跳（8s 间隔） | `GET /api/status`（Bearer），更新状态点与设置页详情 |
| 本地会话发消息 | `POST /api/exec` body `{task, sessionId}`（沿用 v1 单飞流程 + 服务端会话探测） |
| DSH 工作区 | `GET /api/dsh-workspaces` → `{ok, items:[{workspaceId, path, title, sessionCount}]}` |
| DSH 会话列表 | `GET /api/dsh-sessions` → `{ok, items:[{sessionId, cwd, title?, updatedAt}]}`，按 `cwd` 前缀归组到工作区 |
| 会话历史（只读） | `GET /api/dsh-history?sessionId=xxx` → `{ok, items:[{role:'user'\|'assistant'\|'tool', text, time}]}` |
| 继续对话 | `POST /api/dsh-continue` body `{sessionId, task}` → `{ok, result:{ok, exitCode, stdout, stderr, elapsedMs, backend}}` |
| 流式输出 | `GET /api/events?sessionId=xxx&afterSeq=N` → `{ok, items:[{seq, type, text?}], lastSeq}`，1s 轮询增量，打字机渲染 + 工具调用进度行 |
| 审批 | `GET/POST /api/approvals`（🛡 允许一次/拒绝 + 顶栏待授权徽章） |
| 全局记录 | `GET /api/history`，项目列表页展示，可手动刷新 |
| 认证 | 所有 `/api/*` 自动携带 `Authorization: Bearer <token>`；token 存 `localStorage.ph_token` |

错误处理：401 → toast「令牌无效」+ 自动弹令牌窗；新 DSH 接口 404/失败 → 项目页显示
「DSH 同步不可用」提示并优雅降级为纯本地会话；/api/events 不可用 → 回退为「正在执行…」
呼吸灯气泡（continue 仍可正常返回完整结果）。

## 已知 API 缺口（按对接规格如实报告，未臆造）

1. **`/api/dsh-sessions` 条目无消息数**：会话列表规格要求「消息数」，但该接口仅返回
   `{sessionId, cwd, title?, updatedAt}`，逐个拉 /api/dsh-history 计数对 130 会话过重，
   故 UI 显示「cwd + 更新时间」，消息数留空（工作区行显示会话数徽章）。
2. **事件 `type` 取值未定义**：/api/events 的 `type` 枚举未知，UI 按宽匹配处理——
   `done/complete/end/finished/error/failed/result` 视为终止、`tool/tool_call/…` 视为工具
   进度、`stderr/error_text` 记入错误缓冲、其余带 `text` 的条目一律当增量文本。若后端
   使用其他 type 名，流式文本仍会追加，但工具进度行/终止判定可能不精确。
3. **`/api/dsh-history` 条目字段**：规格为 `{role, text, time}`，UI 按此渲染；若实际含
   `at/stdout` 等字段，`time` 缺失时 UI 不显示时间（不报错）。
4. **工作区→会话归组**：若某会话 cwd 不在任何工作区路径下，它不会出现在任何项目下
   （不归入「其他」分组）；工作区徽章数在 /api/dsh-sessions 可用时以实际匹配数优先，
   否则回退到 `sessionCount` 字段。

## 验证

- `node --check`：提取内联 `<script>` 内容临时校验，通过（58KB JS，v2 改动后复验 PASS）。
- 文件为 UTF-8 无 BOM（后端以 `text/html; charset=utf-8` 输出）。
- 浏览器手工验证路径：无 token 首次弹窗 → 输入 token → 连接点变绿 → ☰/面包屑滑入项目列表
  → 工作区加载 → 点项目滑入会话列表 → 点会话加载历史 → 发消息看打字机流式 → 完成后结果气泡
  + 工具卡片 → 右滑返回 → 审批卡片允许/拒绝 → 全局记录展开。
- 调试：`window.__app` 暴露核心函数（sendMessage / navPush / navPop / openDshSession /
  loadWorkspaces / loadDshSessions / api / renderMarkdown / refreshStatus 等）。

## 本地预览（可选，仅开发用）

```powershell
python -m http.server 9000 --directory web
```

浏览器打开 `http://127.0.0.1:9000` 即可预览 UI（API 请求会失败属正常，需连接运行中的 Agent 才有数据）。
