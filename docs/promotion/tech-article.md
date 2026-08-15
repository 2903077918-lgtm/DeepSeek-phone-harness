# 零依赖实现"手机远程控制电脑 Agent"：DeepSeek Phone Harness 架构拆解

> 没有 npm install、没有框架、没有数据库——一个 Node 进程 + 一个 HTML 文件，如何在手机上完整复刻 DeepSeek Harness 的工作体验？

---

## 前言

前一篇介绍了 [DeepSeek Phone Harness](https://github.com/2903077918-lgtm/DeepSeek-phone-harness) 能做什么。这篇聊聊**怎么做的**——一个纯 Node.js 零依赖的 Agent 进程，如何让手机在任何网络下驱动电脑上的 DeepSeek Harness：流式输出、工具调用卡片、审批、提问回答、终端命令，全部实时。

## 整体设计：Agent 是"翻译官"

```
手机浏览器 (relay.html)
   │  HTTPS / Tailscale（4G/5G）
   ▼
Agent（Node, 127.0.0.1:8788）          ← 唯一对外开放的口
   │  ┌─────────────────────────────┐
   ├─▶│ transport-lan: HTTP + 鉴权   │   REST: /api/*  + 静态页面
   ├─▶│ executor: DSH RPC 封装       │   session.* / workspace.* / skill.*
   ├─▶│ approval-relay: WS 中继      │   events.mux 一条连接全收
   │  └─────────────┬───────────────┘
   │                │ 127.0.0.1:3080
   ▼
DeepSeek Harness 网关（dsh web）
```

核心思想：**Agent 不替代 DSH，只做协议翻译**。手机发的是简单的 REST/JSON，Agent 翻译成 DSH 的 Web API RPC（`{type:'client-request', rpcId, method, payload}` 信封），DSH 的事件再反向归一化成手机能用的流。

## 三个关键模块

### 1. transport-lan：一个进程搞定 HTTP + 静态页 + 鉴权

没有 Express，直接用 `node:http` 原生 Server。每一个路由一个 `if`，Bearer Token 统一校验，`sendJson` 统一带 CORS 头（手机可能从任意 Origin 打开页面）。首页直接返回单文件前端 `relay.html`，**服务端渲染与 API 共用同一个端口**——部署零配置。

### 2. executor：DSH RPC 的"会话工厂"

封装了 DSH Web API 的十几个方法：

- `session.create / prompt / history / cancel / rename / fork / models / selectModel`
- `workspace.list`、`skill.list`、`subagent.list`
- 会话注册表（`sessions.json` 持久化）：手机新建的会话重启后还能复用，多轮上下文不断

任务执行是**队列串行**的：同一时间只跑一个任务（DSH 会话单写），手机上看到 `pending` 计数。

### 3. approval-relay：一条 WebSocket 吃下所有实时事件

DSH 的 `events.mux` 是一个 WebSocket 流，里面混着**三种**东西：

| 帧 | 用途 |
| --- | --- |
| `approval/requested` | 危险操作审批 → 手机"需要授权"卡 |
| `question/requested` | Agent 反问（ask_user_question）→ 手机"需要你回答"卡 |
| `session/event` | 会话增量事件（chunk / tool / step）→ 流式打字机 + 工具卡片 |

Agent 用一条常驻 WS 连接全收，分门别类：审批/提问进 pending 表（手机轮询 `/api/approvals`，回答后回传 `/api/respond`），会话事件进每会话的 200 条环形缓冲（手机按 `seq` 增量轮询 `/api/events`）。

**最关键的坑**：`ask_user_question` 不经过审批通道。如果只监听 `approval/requested`，Agent 一提问任务就永远卡住——直到手机回答。所以提问帧必须单独摄入并转发，回答协议与 Web GUI 完全一致（`{ok:true, value:{sessionId, answer:{answers:[{id, selected}]}}}`）。

## 前端：单文件，无框架

`relay.html` 一个文件包含全部界面（codex-relay 设计系统：`#191919` 底、`#C9A227` 金色鲸鱼）：

- **流式**：`/api/events` 按 seq 增量轮询，`text-delta` 追加、`reasoning-delta` 进思考折叠块、`tool-call` 进工具卡片
- **工具卡片**：每个 `tool/call` 建卡（callId 标识、参数里提取**文件路径**），`tool/result` 按 callId 配对转"完成/失败"，点卡片展开完整参数与结果
- **审批/提问**：3 秒轮询 `/api/approvals`，卡片式渲染，回答/跳过即回传
- **模型/附件**：`session.models` 驱动模型选择面板；图片压缩后随 `session.prompt` 作为 image part 提交

## 零依赖的意义

整个 Agent 只有 `node:` 内置模块（http / child_process / crypto / fs）。好处：

- **部署即复制**：`git clone` → `node agent.mjs --mode=both`，没有 install、没有版本地狱
- **可审计**：几千行代码，任何人 20 分钟能读完
- **可跑在任何 Node 22+ 环境**：Windows / macOS / Linux / 树莓派

## 云端可选：Cloudflare Worker

想不依赖 Tailscale、公网直连？`cloud-relay/` 是一个 Cloudflare Worker：托管前端静态资源 + 可选 E2EE 任务通道（WebCrypto P-256 ECDH + AES-GCM，手机与 Agent 之间密钥不落盘）。`wrangler deploy` 一条命令上线。

## 结尾

这个项目证明了：**复杂交互不一定需要复杂架构**。一条 WebSocket、一个 Node 进程、一个 HTML 文件，就能把桌面级 Agent 的工作流完整搬到手机上。

仓库（欢迎 Star / PR / Issue）：

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

下一篇预告：**五分钟把 DeepSeek Phone Harness 跑起来（含 Tailscale 4G/5G 配置）**。
