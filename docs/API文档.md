# deepseekharness-relay API 文档

> 版本：v0.5.0（后端功能完整版，2026-08-14）
> Agent：`C:\Users\Joey\Documents\phone-harness`，监听 `0.0.0.0:8788`
> 认证：除 `GET /`（页面）外，所有 `/api/*` 需 `Authorization: Bearer <token>`（token 在 `config.json`）
> 执行模式：`node agent.mjs --mode=lan|both`（lan=仅 headless；both=DSH Web API 优先+headless 保底）

---

## 一、基础 API

### GET /api/status
Agent 健康状态。
```json
{ "ok": true, "agent": "deepseekharness-relay", "version": "0.5.0", "time": "...", "pending": 0 }
```

### GET /api/history?sessionId=xxx
已执行任务记录（最多 200 条）。可选 `sessionId` 过滤（只返回该会话的任务）。
```json
{ "ok": true, "items": [{ "id", "task", "sessionId?", "ok", "exitCode", "stdout", "stderr", "elapsedMs", "backend", "at" }] }
```

### POST /api/exec
执行任务（body `{task, sessionId?}`）。带 sessionId 复用该会话（继续对话），否则默认逻辑（both 模式复用最近会话）。
```json
// 请求
{ "task": "帮我检查C盘空间", "sessionId": "session-xxx?" }
// 响应
{ "ok": true, "sessionId": "session-xxx?", "result": { "ok", "exitCode", "stdout", "stderr", "elapsedMs", "backend" } }
```

---

## 二、会话管理 API

### GET /api/sessions
Agent 自己的会话注册表（webapi 会话，sessions.json 持久化）。
```json
{ "ok": true, "items": [{ "sessionId", "backend", "createdAt", "lastUsedAt" }] }
```

### POST /api/sessions
新建会话（body 空或 `{}`）→ `{ "ok": true, "sessionId": "session-xxx" }`

---

## 三、审批 API

### GET /api/approvals
待处理审批列表（来自 DSH events.mux 的 approval/requested 帧）。
```json
{ "ok": true, "items": [{ "approvalId", "sessionId", "toolName", "callId?", "reason?", "receivedAt" }] }
```

### POST /api/approvals
回传审批结果。body `{approvalId, outcome}`，outcome 只允许 `allowed-once` / `rejected`。
```json
// 成功
{ "ok": true, "accepted": true }
// 非法 outcome → 400；未知 approvalId → 404
{ "ok": false, "accepted": false, "error": "..." }
```

---

## 四、DSH 同步 API（v2 核心，手机看电脑会话）

### GET /api/dsh-workspaces
电脑上 DSH 的工作区（12 个）+ 每个工作区的会话数（按 cwd 前缀重新分组，修正 DSH sessionIds 不准的问题）。
```json
{ "ok": true, "items": [{ "workspaceId", "path", "title", "sessionCount" }] }
```

### GET /api/dsh-sessions?withCount=true
电脑上 DSH 的全部会话（133 个）。可选 `withCount=true` 附带消息数（逐会话拉 history，仅需时用）。
```json
{ "ok": true, "items": [{
  "sessionId", "cwd", "title?", "updatedAt", "running", "blank",
  "ungrouped": false,        // true=cwd 不匹配任何工作区（未分组）
  "messageCount": 19         // 仅 withCount=true 时有
}] }
```

### POST /api/dsh-continue
**继续电脑上的历史会话**（对已有 DSH sessionId 发消息，不新建）。body `{sessionId, task}`。
```json
{ "ok": true, "sessionId": "session-xxx", "result": { "ok", "exitCode", "stdout", "stderr", "elapsedMs", "backend": "webapi" } }
// 会话不存在 → 404 { "ok": false, "code": "session-not-found", "error": "..." }
```

### GET /api/dsh-history?sessionId=xxx&limit=N
读电脑会话的历史（归一化为对话消息）。可选 limit 取最近 N 条。
```json
{ "ok": true, "items": [{ "role": "user|assistant|tool", "text", "time" }] }
```

### GET /api/events?sessionId=xxx&afterSeq=N
**流式增量轮询**（打字机数据源）。返回 seq > afterSeq 的新事件。
```json
{ "ok": true, "items": [{ "seq", "type", "kind", "time", "text?", "subtype?" }], "lastSeq": 123 }
```

**kind 枚举**（标准化类型，UI 直接用）：

| kind | 含义 | text 说明 |
|---|---|---|
| `text` | 可见文本增量 | 打字机追加的内容 |
| `thinking` | 推理增量 | 通常折叠/隐藏显示 |
| `tool` | 工具调用 | text=工具名 |
| `done` | turn 结束 | 无 text，流式终止信号 |
| `other` | 其他事件 | 忽略或透传 |

**subtype**：text/reasoning/tool/block-start（更细的原始分类，可选）。

---

## 四·五、推送通知 API（PWA Web Push）

手机浏览器（需 HTTPS 安全上下文）启用后，审批 / 提问 / 任务完成会推送到手机。零依赖：VAPID(P-256) + RFC 8291 aes128gcm，免费，无需 APNs/FCM 账号。

### GET /api/push/vapid
返回 VAPID 公钥（base64url，65 字节非压缩点），浏览器 `pushManager.subscribe({ applicationServerKey })` 用。
```json
{ "ok": true, "publicKey": "BHUc96DWxi1ZZp_1..." }
```

### POST /api/push/register
body：`{ subscription: { endpoint, keys: { p256dh, auth } }, deviceLabel? }`。幂等（同 endpoint 复用 id），持久化到 `push-subscriptions.json`。
```json
{ "ok": true, "id": "push-6d6201c3" }
```

### GET /api/push/list
```json
{ "ok": true, "items": [{ "id", "deviceLabel", "at" }] }
```

### POST /api/push/remove
body：`{ id }`。删除订阅。

### POST /api/push/test
给所有订阅发一条测试推送，返回逐条结果（404/410 自动清理失效订阅）。
```json
{ "ok": true, "results": [{ "id", "ok", "status" }] }
```

**通知触发点**：approval-relay 收到 `approval/requested`/`question/requested` 帧、executor `continueSession` 跑完一轮（任务完成）时，经 `pushNotifier.notify` 发给全部订阅。

**前端**：`web/sw.js` 处理 `push`/`notificationclick`；设置页「推送通知」按钮完成 SW 注册 + 订阅 + 上报 + 测试。

---

## 五、技术要点（实现细节）

1. **DSH 事件流是 WebSocket**：`ws://127.0.0.1:3080/api/events.mux`（fetch 会 426）。relay 常驻连接，收 `approval/requested`（审批）+ `session/event`（流式事件）。
2. **chunk 增量提取**：`assistant/chunk` 的 `data.chunk.type` 有 `text-delta`（可见文本）/`reasoning-delta`（推理）/`tool-call-delta`（工具）/`block-start`。修复前只提 `chunk.text` 导致流式失效；现在正确提取三变体。
3. **events 缓冲**：每会话最近 200 条、最多 200 会话 LRU；缓冲缺失时懒回填 `session.history`（5s 冷却）。
4. **工作区分组修正**：DSH 的 workspace.sessionIds 不动态同步（启动时快照），Agent 改为按 cwd 前缀实时分组，voltex 等能正确显示会话数。
5. **会话连续性**：webapi 会话注册表持久化 sessions.json；`POST /api/exec {sessionId}` 或 `/api/dsh-continue` 复用会话，DSH 记住上下文。

---

## 六、测试

> 测试目标矩阵：**独立单测**（不依赖 DSH/agent/网络，可直接跑）+ **集成验证**（需 agent 在 `127.0.0.1:8788`，且有前置检测，未启动会给出清晰提示并退出）。

### 独立单测（不依赖运行态，直接跑）

```bash
# 阶段3 核心模块：protocol / e2ee(X25519+HKDF+AES-GCM) / guard(风险分级) / audit(hash chain) —— 22 项
node test-core-modules.mjs

# 跨端 E2EE（浏览器=Node 同一 e2ee-web.js，P-256 ECDH）一致性 —— 7 项
node test-e2ee-web.mjs

# Agent 云端传输层协议状态机（hello/心跳/断线重连/outbox 回执）—— 12 项（mock socket）
node test-cloud-transport.mjs

# Agent 云端接线器（明文任务流转 + E2EE 加解密 + 风险分级确认）—— 9 项（mock transport/executor）
node test-cloud-service.mjs

# 目标(goal) API：getSessionGoal 拍平 + mutateGoal 不传 ref 自动取投影 ref —— 16 项（mock DSH RPC）
node --experimental-strip-types test-goal-api.mjs

# 云端 REST 控制面服务端：账号/设备注册/配对/任务CRUD(E2EE senderKey/salt)/poll/confirm/kill/result/CORS —— 27 项
node --loader ./test-utils/ts-import-loader.mjs --experimental-strip-types test-cloud-relay-service.mjs   # 在 cloud-relay/ 目录运行
```

### 集成验证（需 agent 已启动，首行自动探测 `127.0.0.1:8788`）

```bash
# E2E：手机→agent→DSH headless→结果回传 + history（模拟 phone 下发任务）
node test-e2e.mjs

# 会话连续性 + 新 UI + history 按 sessionId 过滤 —— 8 项
node test-integration.mjs

# 审批 API（可用 / 非法 outcome=400 / 未授权=401）—— 3 项
node test-approvals.mjs

# v2 后端新字段冒烟（UI/kind/dsh-sessions/cancel 链路）
node verify-v2.mjs

# goal API 对真实 DSH 的 review 验证（会创建/清除真实 goal，慢，仅主动审查用）
node verify-goal-review.mjs
```

启动 agent 前置：`node agent.mjs --mode=both`（或 `start-agent.ps1`）。集成脚本内置 `agentReady()` 前置检测。

---

## 七、已知限制 / 待办

- UI 尚未适配 `kind`/`messageCount`/`ungrouped` 新字段（后端已就绪，UI 适配暂停中）
- `/api/dsh-history` 对超大会话（17k 事件 ≈ 3.8MB）开销大，前端应传 limit
- 流式断线窗口的中间增量可能缺失（relay 重连后靠 history 回填最近 200 条）
