# UI v2 技术验证记录（2026-08-14）

## 已验证的关键能力（决定 v2 设计）

1. **继续电脑会话** ✅：对已有 DSH 历史会话（如 voltex 的 session-019feb16...）调 `session.prompt {sessionId, mode:'queue', content}` 成功——手机端可以"继续"电脑上的历史会话。

2. **流式输出数据源** ✅：WS `ws://127.0.0.1:3080/api/events.mux` 事件流包含帧类型：`session/subscribed`、`session/projection`、`session/event`、`session/queue`。其中 `session/event` 是会话事件推送（含 assistant 增量文本、tool/call 等）——打字机效果的数据源。方案：exec 执行期间前端轮询增量（1s 间隔），或后端缓冲按 seq 增量返回。

3. **项目/会话数据源** ✅：DSH `workspace.list`（12 工作区）+ `session.list`（130 会话）可用；workspace 的 sessionIds 可能不准（voltex 显示 0 但实际有 27 会话），需按 cwd 前缀分组修正。

## v2 设计要点（用户确认）
- ① 手机继续电脑会话（不只读）
- ② 流式输出（打字机）
- ③ iOS 风格三层导航（项目→会话→对话，push/pop 动画）

## 分工
- Agent G（后端）：dsh-workspaces/dsh-sessions/dsh-continue/dsh-history/events 增量 API
- Agent H（UI）：iOS 风格三层导航 + 流式渲染 + 毛玻璃视觉
