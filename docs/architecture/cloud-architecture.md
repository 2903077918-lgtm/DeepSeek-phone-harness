# deepseekharness-relay 云端接入架构设计

- 版本：v0.3（评审稿）
- 日期：2026-08-14
- 作者：架构设计 Agent（C）
- 状态：待主 Agent 与人工评审（对应方案文档阶段 2/3/4 的落地蓝图）
- 上游依据：`docs/deepseekharness-relay-方案.md`（阶段规划）、`agent.mjs`（MVP 现状）、`PROJECT_STATE.md`

> 本文只做设计，不修改任何现有文件。实施（尤其 `agent.mjs` 改动）由主 Agent（A）按本文案执行。

---

## 1. 总体架构（终态）

```
┌─────────────────┐     HTTPS REST + WSS      ┌──────────────────────────────┐
│  手机 App        │ ───────────────────────▶  │  云服务器（控制面）             │
│  iOS / Android  │ ◀───────────────────────  │  ├─ API Gateway / Auth (账号) │
│  任务发起/结果查看│                           │  ├─ 设备注册表 + 绑定关系      │
│  高风险确认弹窗  │                           │  ├─ 任务队列 + 状态机          │
│  推送接收        │                           │  ├─ 推送服务 (FCM/APNs)       │
└─────────────────┘                           │  ├─ 计费/用量 (订阅/按量预留)  │
                                              │  └─ 审计日志                  │
                                              └──────────────┬───────────────┘
                                                             │ 加密长连接 (WSS, Agent 出站)
                                                             ▼
                                              ┌──────────────────────────────┐
                                              │  电脑端 Agent（常驻后台）       │
                                              │  云模式: 连云端 · 心跳/重连    │
                                              │  本地模式: 8788 (兼容 MVP)     │
                                              └──────────────┬───────────────┘
                                                             │ 本地调用
                                                             ▼
                                              ┌──────────────────────────────┐
                                              │  DSH                         │
                                              │  ├─ headless CLI (现有)       │
                                              │  └─ Web API 127.0.0.1:3080    │
                                              │     (阶段2: 会话/流式)        │
                                              └──────────────────────────────┘
```

**设计要点**

1. **Agent 永远出站连接云端**（WSS），不在用户路由器上开任何入站端口 → 兼容 NAT / 家庭宽带 / 运营商大内网，这是"局域网直连"解决不了、云端模式必须解决的问题。
2. **云服务器只做控制面与中继**：不直接调用 DSH，不接触用户的电脑文件；任务内容在阶段 4 强制端到端加密后云端不可读（见第 3 章）。
3. **双通道并存**：局域网直连（低延迟、断网兜底）与云端（随时随地）共用同一套执行器与消息语义，手机端按设备选择通道。
4. **单任务队列**：同一设备同一时刻只执行一个 DSH 任务（headless 为单会话），其余排队 —— 云端队列与 Agent 本地队列语义一致。

---

## 2. 通信协议设计

### 2.1 三层通道总览

| 通道 | 协议 | 用途 | 认证 |
|---|---|---|---|
| 手机 ↔ 云端 | HTTPS REST | 账号、设备、任务增删查、计费 | `Authorization: Bearer <accessToken>`（JWT） |
| 手机 ↔ 云端 | WSS `/v1/ws` | 实时推送：任务状态、确认请求、设备上下线 | 同上（连接时校验） |
| 云端 ↔ Agent | WSS `/v1/agent/ws` | 任务下发/取消、状态/结果回传、配对、kill | `deviceToken`（连接握手，见 3.1） |

### 2.2 手机 ↔ 云端：REST API 草案

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/auth/register` | 注册（邮箱+密码；阶段 4 增加 OAuth） |
| POST | `/v1/auth/login` | 登录 → `{accessToken, refreshToken}` |
| POST | `/v1/auth/refresh` | 轮换 access token |
| GET | `/v1/devices` | 我的设备列表（含在线状态、最后在线时间） |
| POST | `/v1/devices/bind` | `{pairCode}` 绑定配对码（见 3.1） |
| DELETE | `/v1/devices/{deviceId}` | 解绑 / 远程注销 |
| POST | `/v1/devices/{deviceId}/kill` | 紧急停止（远程 kill 开关） |
| POST | `/v1/tasks` | `{deviceId, prompt, riskLevel?, requireConfirm?}` → `{taskId}` |
| GET | `/v1/tasks?deviceId=&status=&limit=` | 任务列表 |
| GET | `/v1/tasks/{taskId}` | 任务详情 + 结果 |
| POST | `/v1/tasks/{taskId}/cancel` | 取消任务 |
| POST | `/v1/tasks/{taskId}/confirm` | 高风险指令确认 `{decision: allow\|deny}` |
| GET | `/v1/me/usage?month=` | 用量（任务数 / 计算时长，计费预留） |
| GET/POST | `/v1/billing/plans`、`/v1/billing/checkout`、`/v1/billing/webhook` | 计费接口预留（阶段 4） |

手机端实时状态统一走 `/v1/ws`，服务端只推送该用户相关事件（任务状态变更、确认请求、设备上下线），避免 REST 轮询。

### 2.3 云端 ↔ Agent：WebSocket 长连接（推荐，弃用轮询）

**为什么选 WSS 长连接而非轮询**

| 维度 | WSS 长连接 | 轮询 |
|---|---|---|
| 任务下发延迟 | 毫秒级实时 | 最短一个轮询周期（体验差） |
| 状态回传 | 即时 | 滞后 |
| 云端负载 | 每设备一条连接 | 每设备 N 次/分钟请求 |
| NAT/防火墙 | 出站连接，天然穿透 | 同样出站，但空转浪费 |
| 断线检测 | 心跳可判活 | 依赖轮询间隔判断 |

**连接生命周期**

```
[启动] → hello(带 deviceToken + resumeToken) → 云端校验 → ack
   │
   ├─ 心跳: Agent 每 25s 发 control.ping → 云端回 control.pong{serverTime}
   │        （连续 3 次无 pong 判定断线；pong 同时用于时钟偏移校正）
   │
   ├─ 断线 → 指数退避重连: 1s→2s→4s→…→上限 60s + 随机抖动 ±20%
   │        → 重连 hello 带 resumeToken → 云端回放 outbox 未确认消息 → 继续工作
   │
   └─ 正常退出 → control.bye → 云端标记 offline
```

**可靠投递（至少一次）**

- 每条消息带 `msgId`（UUID）与发送方单调递增 `seq`；
- 云端为每个 Agent 维护持久化 **outbox**（Redis 或 PG 表）：`task.submit`、`task.cancel`、`confirm.request`、`control.kill` 等指令必须收到 `task.ack`（回执）才出队；重连后按 `resumeToken` 回放未确认消息；
- Agent 侧按 `msgId` 去重（断线期间任务可能已在本地执行）；
- 任务断线期间**继续在本地执行**，重连后补报 `task.status` / `task.result`，不中断。

### 2.4 消息格式：通用信封

所有 WS 消息统一信封，业务字段放 `payload`：

```json
{
  "v": 1,
  "type": "task.submit",
  "msgId": "7f3a9c2e-…",            // UUID，去重/回执用
  "seq": 128,                        // 发送方单调递增序号
  "ts": "2026-08-14T10:00:00.000Z",
  "deviceId": "dev_ab12cd34",
  "payload": { }
}
```

### 2.5 消息类型清单

| type | 方向 | 说明 |
|---|---|---|
| `control.ping` / `control.pong` | 双向 | 心跳 + 服务器时钟 |
| `agent.hello` | Agent→云端 | 连接建立/重连：版本、能力、resumeToken |
| `agent.bye` | Agent→云端 | 正常退出 |
| `agent.state` | Agent→云端 | 在线状态、运行中任务数、DSH 可用性 |
| `bind.confirmed` | 云端→Agent | 配对完成（手机确认后通知） |
| `bind.revoked` | 云端→Agent | 解绑/注销通知 → Agent 清凭据 |
| `task.submit` | 云端→Agent | 任务下发 |
| `task.cancel` | 云端→Agent | 取消指令 |
| `task.status` | Agent→云端 | 状态更新（含进度） |
| `task.result` | Agent→云端 | 最终结果 |
| `task.ack` | 双向 | 消息回执（可靠投递） |
| `confirm.request` | 云端→Agent | 高风险确认请求（转发给手机） |
| `confirm.response` | Agent→云端 | 手机确认结果回传 |
| `control.kill` | 云端→Agent | 紧急停止（kill 开关） |
| `error` | 双向 | 错误码 + 说明 |

### 2.6 核心 JSON Schema 草案

**task.submit（云端 → Agent）**

```json
{
  "taskId": "tsk_20260814_9f2a",
  "mode": "headless",                // headless | web（阶段2起）
  "prompt": "检查一下 C 盘剩余空间",
  "priority": "normal",              // normal | high
  "riskLevel": "low",                // low | medium | high（云端预判，Agent 复核）
  "requireConfirm": true,            // 是否要求电脑端人工确认后执行
  "timeoutMs": 600000,               // 单任务超时（当前 10 分钟）
  "createdAt": "2026-08-14T10:00:00.000Z"
}
```

**task.status（Agent → 云端）**

```json
{
  "taskId": "tsk_…",
  "status": "running",               // queued|confirming|running|succeeded|failed|cancelled|timeout
  "stage": "dsh_running",            // queued|confirm_wait|dsh_spawned|dsh_running|finalizing
  "detail": "正在调用 shell 工具检查磁盘…",
  "updatedAt": "2026-08-14T10:00:17.000Z"
}
```

**task.result（Agent → 云端）**

```json
{
  "taskId": "tsk_…",
  "ok": true,
  "exitCode": 0,
  "stdout": "C 盘剩余空间: 128.4 GB",
  "stderr": "",
  "elapsedMs": 17200,
  "toolCalls": [
    { "name": "shell", "args": "dir C:\\", "summary": "列出 C 盘根目录" }
  ],
  "finishedAt": "2026-08-14T10:00:20.000Z"
}
```

> `toolCalls` 是审计摘要（不存完整输出），是审计日志与风险判定的数据来源。

**task.cancel（云端 → Agent）**

```json
{ "taskId": "tsk_…", "reason": "user_cancel", "requestedBy": "user_9x" }
```

**confirm.request（云端 → Agent）与 confirm.response（Agent → 云端）**

```json
{
  "requestId": "cfm_41",
  "taskId": "tsk_…",
  "prompt": "删除 C:\\temp\\old-version 目录",
  "riskSummary": "将执行递归删除操作: Remove-Item -Recurse -Force",
  "riskLevel": "high",
  "expiresAt": "2026-08-14T10:01:00.000Z"
}
```

```json
{
  "requestId": "cfm_41",
  "decision": "allow",               // allow | deny | timeout
  "operator": "user@phone",          // 谁确认的
  "at": "2026-08-14T10:00:55.000Z"
}
```

**agent.hello（Agent → 云端，连接/重连时）**

```json
{
  "agentId": "agt_7e1a",
  "deviceId": "dev_ab12cd34",
  "version": "0.3.0",
  "os": "win32",
  "publicKeyX25519": "base64url…",   // E2EE 公钥（见 3.3）
  "capabilities": ["headless", "web", "confirm", "e2ee-v1"],
  "resumeToken": "…",                // 断线恢复凭证（一次有效）
  "pendingTasks": ["tsk_…"]          // 断线期间仍在执行的任务
}
```

**control.kill（云端 → Agent）**

```json
{ "reason": "user_request", "until": "2026-08-14T11:00:00.000Z" }
```

Agent 收到后：立即终止当前任务 → 进入 `killed` 状态（不再接受新任务）→ 直到用户在电脑端手动解除或云端发解除指令。**kill 是最高优先级，任何情况下先于任务处理。**

---

## 3. 身份与安全

### 3.1 设备注册 / 配对流程（电脑端生成配对码 → 手机确认绑定）

```
电脑端 Agent（首次启动 / agent.mjs --pair）
  ① 生成 deviceId（UUID）+ X25519 身份密钥对（私钥本机加密存储）
  ② 生成 8 位配对码（base32，剔除易混淆字符 0/O、1/I/L）
     有效期 15 分钟、一次性、只存哈希不存明文
  ③ 连云端（未绑定状态）上报 {deviceId, publicKeyX25519, pairCode}

手机 App
  ④ 用户已登录云账号 → 输入配对码
  ⑤ 云端校验（有效 & 未使用 & 未过期）→ 绑定 deviceId 到该用户 → 标记 used

云端 → Agent
  ⑥ 推送 bind.confirmed {userId, serverPubKey?}
  ⑦ Agent 本地持久化绑定信息，生成/轮换 deviceToken，握手完成
```

之后：手机可向该设备发任务；Agent 以 `deviceToken` 认证 WS 连接。

**防中间人（云端作恶）缓解**：配对码本身经云端传递，纯靠它无法防云端替换公钥。可选增强——**二维码离线交换**：Agent 在控制台显示二维码（含 `deviceId` + 公钥指纹前 8 位），手机 App 扫码比对指纹后绑定；二维码路径不经云端，云端无法替换公钥（详见 3.3）。

### 3.2 token 体系与轮换

| 凭据 | 用途 | 有效期 | 轮换/撤销 |
|---|---|---|---|
| accessToken（JWT） | 手机 REST/WS 认证 | 30 min | refresh 轮换；登出即废 |
| refreshToken（opaque，库中存 SHA-256） | 换新 access | 30 天 | 可撤销（登出/改密/风控） |
| deviceToken（Agent） | Agent WS 认证 | 24 h | 每次重连/每日轮换；解绑即撤销 |
| resumeToken（Agent） | 断线恢复 | 一次有效 | 每次重连作废重发 |

云端维护 `tokens` 表（见 4.3），撤销 = 置 `revoked_at` + 查询时校验。

### 3.3 端到端加密（E2EE：客户自持密钥，服务器不可读任务内容）

**目标**：云服务器只转发密文，无法解密任务内容与结果；明文只存在于手机 App 与电脑 Agent 两端。

**密钥交换方案（X25519 + HKDF + AES-256-GCM，v1 静态共享密钥）**

```
设备侧:  X25519 身份密钥对 dev_priv / dev_pub   （私钥: Windows DPAPI 或文件 0600）
手机侧:  X25519 用户密钥对 user_priv / user_pub （私钥: iOS Keychain / Android Keystore）

共享密钥派生（绑定完成后首次任务前各端独立计算）:
  shared = ECDH(dev_priv, user_pub)             // 双向一致
  key    = HKDF-SHA256(ikm=shared, salt=随机32B, info="ph-e2ee-v1")

每条消息加密:
  nonce = 随机 12B
  ciphertext = AES-256-GCM(key, nonce, plaintext, AAD = {taskId, deviceId, userPub})
```

- **公钥交换**：绑定流程中经云端交换；**推荐叠加二维码离线比对指纹**，彻底消除"云端替换公钥做 MITM"的可能（指纹不匹配则拒绝建立加密会话）。
- **服务器可见**：密文 + 元数据（任务时间、设备、大小、状态机）。E2EE 保护的是"任务内容"，元数据不可避免——写入隐私政策明示。
- **密钥丢失**：不可找回（这是特性不是缺陷，符合"服务器不可读"承诺）；换手机/重装系统需重新配对，旧密文永久不可读。可选改进：手机侧密钥加密后同步到 iCloud/Google 云备份（密钥由用户口令派生加密）。
- **升级路径**：v1 用静态共享密钥（每任务随机 nonce）；v2 引入每任务临时密钥（前向保密）；完整 Signal 双棘轮协议仅在确有威胁模型需求时引入，避免过度设计。
- **强制策略**：阶段 3（自用服务器）E2EE 代码路径就位、默认开启；阶段 4（多租户）**强制开启，不可关闭**。

### 3.4 高风险指令确认（授权弹窗）

**风险分级**（Agent 本地规则引擎，正则+启发式）：

| 级别 | 示例 |
|---|---|
| low | 只读查询、状态查看 |
| medium | 写文件到用户目录、网络请求 |
| high | 递归/强制删除、格式化、磁盘擦除、注册表修改、停服务、执行下载的脚本、提权、改防火墙/安全设置 |

**流程**

```
Agent 收到 task.submit（或 DSH 工具调用前检测到高危动作）
  → 判定 riskLevel=high 且 requireConfirm=true（或策略为"始终确认"）
  → 云端转发 confirm.request → 手机弹窗（任务、风险摘要、60s 过期）
  → 用户 allow/deny → confirm.response → Agent 放行或终止任务
  → 超时未确认 = 默认拒绝（fail-safe）
```

**确认策略（每设备可配置）**：始终确认 / 仅高危确认（默认）/ 白名单免确认。确认动作全量记入审计日志。

### 3.5 审计日志

- **云端**：`audit_log` 表记录登录、绑定/解绑、任务全生命周期事件、确认决策、kill 操作（含 IP/UA）。
- **Agent 本地**：`audit.json` **追加式**日志（防云端不可信时本地留痕）；可选 hash chain（每行含上一行哈希）防篡改。
- 任务内容：明文只在两端；云端存密文 + 审计摘要（toolCalls 摘要，不含完整输出）。

### 3.6 远程注销 / 紧急停止

| 场景 | 动作 |
|---|---|
| 手机解绑设备 | 云端撤销 deviceToken → `bind.revoked` → Agent 清空本地凭据，进入 unbound 状态 |
| 账号被盗/异常 | 用户一键"紧急停止所有设备"→ 全设备 `control.kill` + 撤销所有 refresh/device token |
| 单设备失控 | 手机端 kill 开关 → Agent 终止当前任务并暂停接单直到本地解除 |
| 离职/换机 | 解绑 + 重置配对码 |

---

## 4. 云端组件设计

### 4.1 技术选型建议

| 组件 | 选型 | 理由 |
|---|---|---|
| 运行时 | Node.js 20+（TypeScript） | 与 Agent 同语言，协议库/消息 schema 单份复用 |
| Web 框架 | Fastify | 轻量、schema 校验内置；WS 用 `ws` 库（自定协议，不用 Socket.IO） |
| 反向代理/TLS | Caddy（自动 Let's Encrypt） | 零配置 HTTPS；阶段 4 换 nginx/云 LB |
| 部署起步 | 单台 VPS（Hetzner/Contabo/阿里云轻量）→ Docker + docker-compose | 阶段 3 省钱可验证；规模化再上 K8s |
| 数据库 | PostgreSQL 14+（自托管或云 RDS） | 关系模型契合 ER；JSONB 存事件 |
| 缓存/队列 | Redis（在线状态、outbox、限流、BullMQ 任务队列） | 成熟、与 Node 生态贴合 |
| 推送 | FCM + APNs（阶段 4） | 上架必需；阶段 3 用 WSS 实时通知即可 |
| 日志/观测 | pino 结构化日志 + 简单指标（任务成功率、WS 在线率、耗时分位） | 先跑通再上完整可观测栈 |

**单机起步原则**：阶段 3 允许 PostgreSQL+Redis 与 API 同机；用 docker-compose 保证可迁移，避免一开始就引入云原生复杂度。

### 4.2 进程/服务划分（阶段 4 形态）

```
api        Fastify: REST + OAuth + 计费 webhook
ws-gw      WS 网关: 手机 /v1/ws 与 Agent /v1/agent/ws（可水平扩展，Redis pub/sub 广播）
worker     BullMQ worker: 任务状态机推进、超时检测、推送触发
notify     推送封装（FCM/APNs）
```

### 4.3 数据模型（ER 草图）

```
users ──┬──< devices (1:N)
        ├──< tasks (1:N)
        ├──< subscriptions (0..1)
        └──< usage (按月 1:N)

devices ──< tasks (1:N)
devices ──< pair_codes (1:N)
tasks  ───< task_events (1:N)
```

**表结构（PG DDL 摘要）**

```sql
users(
  id UUID PK, email CITEXT UNIQUE, password_hash TEXT,
  plan TEXT DEFAULT 'free',           -- free|pro|power
  status TEXT DEFAULT 'active',       -- active|disabled
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
);

devices(
  id UUID PK,                          -- 云端侧 ID
  agent_id TEXT UNIQUE,                -- Agent 生成的稳定 ID
  user_id UUID REFERENCES users,       -- NULL = 未绑定
  name TEXT, os TEXT, arch TEXT, version TEXT,
  public_key_x25519 TEXT,              -- E2EE 公钥
  status TEXT DEFAULT 'unbound',       -- unbound|online|offline|killed
  last_seen_at TIMESTAMPTZ, bound_at TIMESTAMPTZ,
  kill_until TIMESTAMPTZ,              -- 紧急停止截止
  created_at TIMESTAMPTZ
);

pair_codes(
  id UUID PK, code_hash TEXT UNIQUE,   -- 只存哈希
  device_id UUID REFERENCES devices,
  created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ, used_by_user UUID
);

tasks(
  id UUID PK, user_id UUID REFERENCES users, device_id UUID REFERENCES devices,
  status TEXT,                         -- queued|sent|confirming|running|succeeded|failed|cancelled|timeout
  prompt_cipher BYTEA, result_cipher BYTEA,   -- E2EE 密文（prompt 经手机加密、结果经 Agent 加密）
  mode TEXT DEFAULT 'headless', risk_level TEXT,
  require_confirm BOOL, confirm_decision TEXT,
  priority TEXT DEFAULT 'normal', timeout_ms INT,
  created_at TIMESTAMPTZ, started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ, elapsed_ms INT, exit_code INT
);
CREATE INDEX idx_tasks_user ON tasks(user_id, created_at DESC);
CREATE INDEX idx_tasks_device ON tasks(device_id, status);

task_events(
  id BIGSERIAL PK, task_id UUID REFERENCES tasks,
  type TEXT, payload JSONB, at TIMESTAMPTZ
);

tokens(
  hash TEXT PK,                        -- SHA-256(refresh/device/resume token)
  user_id UUID, device_id UUID, kind TEXT,  -- refresh|device|resume
  expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ
);

audit_log(
  id BIGSERIAL PK, user_id UUID, device_id UUID,
  action TEXT, detail JSONB, ip INET, user_agent TEXT, at TIMESTAMPTZ
);

-- 计费（预留）
plans(id UUID PK, name TEXT, price_cents INT, currency TEXT,
      quota_tasks_per_month INT, features JSONB);
subscriptions(id UUID PK, user_id UUID, plan_id UUID, status TEXT,
              provider TEXT, period_start TIMESTAMPTZ, period_end TIMESTAMPTZ);
usage(id BIGSERIAL PK, user_id UUID, month TEXT,             -- 'YYYY-MM'
      task_count INT, compute_minutes INT, UNIQUE(user_id, month));
```

**Redis 键**（运行态，不落库）：`online:{deviceId}`（TTL 90s，心跳续）、`outbox:{deviceId}`（未 ack 消息）、`rate:login:{ip}`（限流计数）。

### 4.4 任务状态机（云端）

```
queued ──▶ sent ──▶ confirming ──▶ running ──▶ succeeded
  │         │          │             │          ├─ failed
  │         │          └──(deny/超时)┴─▶ cancelled
  └─────────┴──────────(cancel/kill)─┴─▶ cancelled / timeout
```

推进由 worker 负责：下发超时未 ack → 重投；running 超时 → 发 `task.cancel(reason=timeout)`；confirming 超时 → 自动 deny。**每次状态迁移写 `task_events`**。

### 4.5 计费模式接口预留

- **模式**：订阅（free 5 任务/月 → pro → power）+ 按量（超额按任务数/计算分钟计费），双轨预留。
- **计费点**：`task.finished` 事件 → 写 `usage`（task_count + compute_minutes）→ 配额校验在任务创建时做。
- **支付渠道**：Web 端 Stripe/支付宝/微信；**App 内必须走 Apple IAP / Google Play Billing**（商店强制），云端只做服务端校验与 webhook 对账。
- **预留接口**：`/v1/billing/plans`、`/v1/billing/checkout`、`/v1/billing/webhook`（已列于 2.2），数据表已建（4.3），阶段 4 只接渠道不重建模型。

---

## 5. 与现有 MVP 的衔接（agent.mjs 演进蓝图）

> 本小节是**设计蓝图**，实施由主 Agent（A）负责，不在本任务中改代码。

### 5.1 演进原则

1. **LAN 模式零破坏**：现有 8788 HTTP 服务、Bearer token、`/api/*` 路由原样保留，`config.json` 向后兼容。
2. **执行与传输解耦**：先把"执行 DSH"（executor）与"消息收发"（transport）分开，云端接入只是新增一个 transport。
3. **新能力默认关闭**：`mode: "lan"`（默认）→ `"cloud"` / `"both"` 由配置开启。

### 5.2 目标模块结构（阶段 3 前完成拆分）

```
agent.mjs            # 入口：加载配置、启动 lan/cloud 通道、信号处理（保持小）
lib/
  config.mjs         # config.json 读写：mode、lanToken、cloud 凭据、e2ee 私钥
  executor.mjs       # 执行器抽象: run({mode:'headless'|'web'}) → 结果
  history.mjs        # history.json 读写（现状迁移）
  guard.mjs          # 高风险指令检测 + 确认流程（3.4）
  audit.mjs          # 本地追加式审计日志（3.5）
  transport/
    lan.mjs          # 现有 HTTP server（原样迁移）
    cloud.mjs        # WSS 客户端：hello/心跳/重连/outbox 回执/消息分发
    protocol.mjs     # 信封编解码 + 消息类型 + JSON schema 校验（与云端共享一份）
  e2ee.mjs           # X25519 + HKDF + AES-GCM（3.3）
```

**Transport 抽象接口**（LAN 与 Cloud 实现同一接口）：

```js
class Transport {
  onConnect(cb); onDisconnect(cb); onMessage(cb);
  sendStatus(taskId, status, extra);   // task.status
  sendResult(taskId, result);          // task.result
  sendAck(msgId);                      // 可靠投递回执
}
```

### 5.3 config.json 演进（示意）

```json
{
  "token": "现有 LAN token…",
  "mode": "both",
  "lan": { "port": 8788 },
  "cloud": {
    "url": "wss://relay.example.com/v1/agent/ws",
    "deviceId": "dev_ab12cd34",
    "deviceToken": "…",
    "refreshToken": "…",
    "e2ee": { "privateKeyX25519": "…", "peerPublicKey": "…" }
  },
  "confirmPolicy": "high",             // always|high|whitelist
  "killUntil": null
}
```

### 5.4 双通道语义

- 同一时刻同一设备只跑一个 DSH 任务（**Agent 本地也加任务队列**，LAN 与 Cloud 请求统一入队）；当前 MVP 的并发 spawn 属隐患，拆分时一并修正。
- 云端任务与 LAN 任务共享 executor 与 guard；手机端按设备选择"局域网直连（快）"或"云端（任何网络）"。
- 断网兜底：云端通道断开时，若手机与电脑同网，可自动切 LAN 通道（App 端逻辑）。

### 5.5 阶段 2 的 Web 通道（体验增强）

`executor.mjs` 提供两个执行后端：

| 后端 | 说明 |
|---|---|
| `headless` | 现状 `dsh --profile headless`（保底，无会话） |
| `web` | 调 DSH Web API（127.0.0.1:3080）：`clientId` 保持会话、SSE 流式输出、工具调用事件流 |

流式输出经 `task.status(stage/detail)` 逐段回传手机 → 手机能看到 DSH 实时工具调用（官方级体验）。工具调用事件流同时是 `guard.mjs` 高危拦截的输入。

---

## 6. 分阶段落地路线

### 阶段 2：体验增强（局域网内，无云）

| 项 | 内容 |
|---|---|
| 目标 | 手机端体验接近官方 Web：会话连续、流式、可取消 |
| 实施 | ① agent.mjs 拆分 executor/transport（5.2）；② 加本地任务队列；③ Web 通道接入 dsh web API（clientId + SSE）；④ 前端轮询改流式；⑤ guard 高危检测雏形 |
| 验收 | 手机能看到 DSH 工具调用实时输出；会话可续；可中途取消 |
| 不做 | 任何云端 |

### 阶段 3：云端中转 MVP（单用户自用）

| 项 | 内容 |
|---|---|
| 云 | 单 VPS + Caddy(TLS) + Fastify + `ws` + PostgreSQL + Redis（docker-compose） |
| 账号 | 极简：部署者创建账号（邮箱+密码）；不做 OAuth |
| Agent | cloud 模式：WSS 出站、hello/心跳/指数退避重连/断线恢复、deviceToken 认证、配对码绑定、outbox 回执 |
| 手机 | 沿用 `web/` 改造为 **PWA**（HTTPS + WSS），不先做原生 App；推送用 WSS 实时通知，暂不接 FCM/APNs |
| 安全 | TLS 强制；token 轮换；设备绑定；E2EE 代码路径就位、默认开启（自用服务器也养成习惯） |
| 验收 | 手机 4G 控制家里 NAT 后的电脑完成任务；拔网线自动重连补报；手机可远程注销设备、kill 设备 |
| 不做 | 多租户完善、支付、原生 App、推送 |

**单用户自用 = 云上先跑通全链路**，E2EE、审计、kill 等安全机制在真实网络条件下验证，为阶段 4 铺路。

### 阶段 4：多租户产品化

| 项 | 内容 |
|---|---|
| 账号 | OAuth（Google/Apple/微信）+ 多设备管理 + 设备分组 |
| 客户端 | 原生 App（Flutter 或 React Native）+ 上架 App Store / Google Play |
| 推送/保活 | FCM + APNs；iOS 后台限制靠推送唤醒，Android 前台服务 + 电池优化白名单 |
| 支付 | Apple IAP / Google Play Billing + Stripe（Web）；订阅+按量双轨 |
| 安全 | E2EE 强制；审计产品化；滥用防护（登录/API 限流、风控、封禁） |
| 开源 | **open core**：Agent + 协议规范开源引流，云端闭源按订阅收费 |
| 合规 | 隐私政策、ToS、数据处理、上架材料（见第 7 章） |

---

## 7. 风险与合规

### 7.1 上架审核（远程控制类）

| 渠道 | 风险 | 对策 |
|---|---|---|
| Apple App Store | 远程控制/设备管理类易被拒或要求额外说明；可能被误判为恶意控制工具 | ① 先 PWA 验证再上原生；② 提交时附用途说明（"控制**自己**的设备"）+ 演示视频；③ 突出安全机制：确认弹窗、E2EE、审计日志、kill 开关；④ 提前准备 App Privacy 标签与隐私政策 URL |
| Google Play | 相对宽松，但同样要求隐私政策、权限最小化 | 同左；注意"设备管理"类权限（若用到）需额外声明，尽量不用 |
| 通用 | 被反病毒软件标记（Agent 常驻+远程执行） | Agent 代码签名；文档化说明；开源降低信任成本 |

### 7.2 隐私与数据留存

- **明示收集**：账号信息、设备信息（OS/版本/设备名）、任务元数据（时间/设备/状态/大小）、任务内容（加密后留存，明文仅两端）。
- **留存策略**：任务密文默认留存 30 天（可配置为 0 = 结果回传后即删）；审计日志按法规留存（建议 180 天）；用户可自助删除账号及全部数据（GDPR/个保法要求）。
- **隐私政策**：上架前必须就位，覆盖数据收集、用途、第三方（支付/推送/云厂商）、跨境、删除权。
- **E2EE 卖点即合规点**：服务器不可读任务内容，写入隐私政策与营销材料。

### 7.3 滥用防护

- 限流：登录（按 IP/账号）、API、WS 连接频率；Redis 计数。
- 风控：异常高频任务、陌生设备登录、异常地域 → 触发验证/封禁。
- 内容安全（可选）：明文只在两端，云端无法做内容审核 → 靠**行为风控**（任务量、工具调用模式）+ 用户举报。
- ToS 明确禁止：控制他人设备、利用任务攻击第三方、批量爬虫等；违规封禁 + 注销设备。

### 7.4 技术风险清单

| 风险 | 缓解 |
|---|---|
| Agent 常驻被误杀/开机自启失败 | 安装为系统服务（Windows 计划任务/服务），自愈重启 |
| 断线期间任务结果丢失 | 本地持久化 pending 结果，重连补报（outbox 语义对称） |
| 云端单点故障 | 阶段 3 接受单机；阶段 4 上多副本 + Redis 状态收敛 |
| 密钥泄露（Agent 私钥） | 本机 DPAPI/权限位保护；泄露后重新配对 + 吊销旧公钥 |
| DSH 依赖 DEEPSEEK_API_KEY 在电脑侧 | 保持不变（密钥不上云，也是安全卖点） |
| 供应链 | npm 依赖审计（`npm audit` + 锁定版本）；Agent 保持零/极少第三方依赖 |

### 7.5 回滚

- Agent 是旁路程序：删除/停用 cloud 通道即回到纯 LAN MVP，DSH 零改动。
- 云端按阶段独立部署：阶段 3 服务与阶段 4 兼容演进，失败可回退到前一版 docker-compose。
- `config.json` 的 `mode` 字段保证任意时刻切回 `lan`。

---

## 附录 A：关键设计决策（ADR 摘要）

| # | 决策 | 理由 |
|---|---|---|
| D1 | Agent → 云端用 WSS 出站长连接，不用入站端口/轮询 | NAT 穿透、低延迟、省资源 |
| D2 | 云端与 Agent 共享同一套协议库（信封 + schema） | 一份实现，类型安全，双端演进同步 |
| D3 | 可靠投递 = 云端 outbox + msgId 回执 + resumeToken 断线恢复，任务断线期间本地继续执行 | 至少一次投递 + 不中断任务 |
| D4 | E2EE = X25519 ECDH + HKDF-SHA256 + AES-256-GCM，静态共享密钥 v1 | 服务器不可读任务内容；v1 避免双棘轮过度设计 |
| D5 | 配对 = 电脑端生成一次性配对码 → 手机确认绑定；二维码指纹比对可选增强 | 云端无法冒充设备；指纹离线比对消除 MITM |
| D6 | 高风险指令默认"仅高危确认"，超时默认拒绝（fail-safe） | 安全优先，不牺牲日常使用流畅度 |
| D7 | 单任务队列（设备级串行）+ 状态机集中云端 | 与 headless 单会话匹配；状态可审计可恢复 |
| D8 | 技术栈 Node.js/Fastify/PostgreSQL/Redis，阶段 3 单 VPS 起步 | 与 Agent 同语言、成本最低、可平滑扩展 |
| D9 | 阶段 3 用 PWA 验证、阶段 4 再上原生 App + IAP | 快速验证云端链路，规避早期上架审核成本 |
| D10 | open core：Agent + 协议开源，云端闭源订阅收费 | 开源引流（信任 + 社区）+ 收费闭环 |
