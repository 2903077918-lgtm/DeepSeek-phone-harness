<div align="center">

# 🐋 phone-harness

### 把 DeepSeek Harness 装进口袋 —— 手机远程控制你的电脑 Agent

**DeepSeek Harness on your phone. Remote-control your desktop agent from anywhere — 4G/5G, no WiFi needed.**

`Node.js` · `零依赖` · `Cloudflare Workers` · `WebCrypto E2EE`

</div>

---

## 这是什么？

**phone-harness** 是一个手机端远程控制系统，让你在任何网络（4G/5G / WiFi / 公网）下，用手机操作电脑上的 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) —— 发任务、看流式输出、批准工具调用、回答 Agent 提问、跑终端命令、翻文件、查任务记录，全都在手掌心里完成。

界面参考开源项目 [codex-relay](https://github.com/gronxb/codex-relay) 的设计语言，对话体验对标 DeepSeek Harness Web GUI：**模型选择、图片附件、思考过程折叠、工具调用卡片（带路径/状态/详情）、审批与提问卡**，一样不少。

---

## ✨ 核心特性

| 能力 | 说明 |
| --- | --- |
| 💬 **对话** | 多轮会话、Markdown 渲染、流式打字机输出、会话历史 |
| 🎛 **模型选择** | 顶部模型胶囊 → 底部面板，多 Provider / 多模型即时切换（如 deepseek-v4-flash / v4-pro） |
| 🖼 **图片附件** | `+` 按钮选图，自动压缩，随任务作为图片输入提交 |
| 🧠 **思考过程** | Agent 推理内容折叠展示，流式时自动展开 |
| 🔧 **工具卡片** | 每一步操作一张卡：图标 + 状态（执行中/完成/失败）+ **文件路径参数** + 点击展开完整参数与结果 |
| 🛡 **审批与提问** | 危险操作审批卡（允许/拒绝）、`ask_user_question` 提问卡（选项/自定义回答/跳过），不回答任务不卡死 |
| ⌨️ **终端** | 手机远程执行电脑命令，流式输出、可停止、支持 UTF-8 中文 |
| 📋 **任务列表** | 历史任务回看、展开 stdout/stderr、一键重跑、复制输出 |
| 📁 **文件与代码** | 浏览电脑目录、查看文件内容（代码界面） |
| 🗂 **工作区/会话** | 多项目工作区切换、会话新建 / 重命名 / 删除 / 搜索 |
| 📡 **任意网络** | Tailscale 4G/5G 直连电脑，或经 Cloudflare Worker 云端入口 |
| 🔒 **安全** | Bearer Token 鉴权、审批/提问需手机确认、E2EE 可选（云端通道） |

---

## 🏗 架构

```
┌──────────────┐      HTTPS / Tailscale       ┌─────────────────────────────┐
│   手机浏览器   │ ──────────────────────────▶ │  Agent（电脑端, Node, 8788） │
│  relay.html  │                              │  ┌─────────────────────────┐ │
│  codex-relay │                              │  │ transport-lan（HTTP+鉴权）│ │
│  风格 UI     │ ◀── 流式事件轮询 /api/events ─│  │ executor（DSH RPC 封装） │ │
└──────────────┘                              │  │ approval-relay（WS 中继） │ │
        │                                     │  └───────────┬─────────────┘ │
        │ 可选：Cloudflare Worker 静态托管     │              │ 127.0.0.1:3080  │
        ▼                                     │              ▼                 │
┌──────────────┐                              │  ┌─────────────────────────┐ │
│ relay.axyntara│  ◀── 手机直接访问 Worker ─────  │  │  DeepSeek Harness 网关  │ │
│ .cn (Worker) │                              │  │  (dsh web, 会话/工具)    │ │
└──────────────┘                              │  └─────────────────────────┘ │
                                              └─────────────────────────────┘
```

- **Agent**：纯 Node.js 实现，零第三方依赖。HTTP 传输层（8788）+ DSH Web API RPC 封装（`127.0.0.1:3080`）+ 审批/事件中继（`events.mux` WebSocket）。
- **前端**：单文件 `relay.html`，无框架，深色 codex-relay 设计系统（`#191919` / 金色鲸鱼标识）。
- **云端**：`cloud-relay/` 为 Cloudflare Worker（可选），托管前端静态资源并支持 E2EE 任务通道（Supabase 可选）。

---

## 🚀 快速开始

### 前置条件

- 电脑已安装并运行 **DeepSeek Harness Web**（`dsh web`，监听 `127.0.0.1:3080`）
- Node.js 22+（Agent 使用全局 `fetch` / `WebSocket`）

### 1. 配置并启动 Agent

```bash
# 1) 复制配置模板并填写访问令牌
cp config.example.json config.json

# 2) 启动（LAN 8788 + 云端轮询）
node agent.mjs --mode=both
```

启动后终端会打印本机地址与 Token：

```
deepseekharness-relay Agent v0.4.0
 控制台: http://<本机IP>:8788
 Token:  <你的访问令牌>
```

### 2. 手机连接

1. 手机与电脑同一 Tailscale 网络（4G/5G 也可直连）：打开 `http://<电脑Tailscale IP>:8788/`
2. 或在任意网络访问云端入口：`https://relay.axyntara.cn/`
3. 输入服务器地址 + 访问令牌 → 连接 → 选择工作区 → 开始对话

### 3. 云端部署（可选）

```bash
cd cloud-relay
wrangler deploy   # 需要 Cloudflare 账号；静态资源来自 ../web
```

---

## 🗂 目录结构

```
phone-harness/
├── agent.mjs            # Agent 入口（--mode=lan|cloud|both）
├── src/
│   ├── transport-lan.js # 局域网 HTTP 传输层（8788，REST + 静态页）
│   ├── executor.js      # DSH RPC 封装：会话/历史/审批/模型/终端等
│   ├── approval-relay.js# events.mux WebSocket 中继（审批+提问+事件流）
│   ├── dsh-utils.js     # RPC/事件归一化工具
│   └── config.js        # 端口 / 版本 / API Key 解析
├── web/
│   ├── relay.html       # ★ 手机端主界面（单文件，codex-relay 风格）
│   ├── index.html       # 与 relay.html 同步（云端根路径）
│   └── console.html     # 旧版局域网控制台（归档）
├── cloud-relay/         # Cloudflare Worker（静态托管 + 可选 E2EE 通道）
└── t-e2e-question.mjs   # 端到端测试脚本
```

---

## 🔐 安全说明

- 所有 API 均要求 `Authorization: Bearer <token>`，token 由 `config.json` 管理且 **不入库**（见 `.gitignore`）。
- 工具调用采用 **审批制**：危险操作会先在手机端弹出「需要授权」卡片，由你决定允许/拒绝。
- Agent 反问用户时必须手机回答（提问卡），否则任务会等待，不会擅自继续。
- 建议仅在 Tailscale 等私有网络暴露 8788；公网请经 Cloudflare Worker 并开启 E2EE。

---

## 🗺 Roadmap

- [x] 对话 / 流式 / 模型选择 / 图片附件
- [x] 工具卡片（路径·状态·详情）/ 思考过程 / 审批 / 提问
- [x] 终端 / 任务列表 / 文件与代码 / 会话管理
- [ ] 移动端 PWA（离线壳 + 推送）
- [ ] 会话「继续在电脑端打开」
- [ ] 更多模型 Provider 快捷切换
- [ ] 多设备 / 多账号

---

## 📄 License

[MIT](./LICENSE) © 2026 项目作者

> DeepSeek Harness 手机远程控制 —— 让 Agent 随时随地在手边工作。
