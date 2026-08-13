# deepseekharness-relay —— 手机远程控制 DSH 产品方案

- 版本：v0.2（评审稿，产品命名后更新）
- 日期：2026-08-14
- 状态：待人工评审（L3 高风险项目，分阶段执行）

---

## 1. 项目概述

**产品名**：deepseekharness-relay

**目标**：开发一款类似 Codex Relay 的产品——用户用手机（iOS/Android）远程控制自己电脑上运行的 DSH（DeepSeek Harness），下发自然语言任务并查看执行结果；远期可开源引流 + Pro 订阅收费。抢在 DeepSeek 官方推出同类产品之前完成。

**核心价值**：把"电脑上的 AI 编程/自动化 Agent"变成"口袋里的远程助手"。

---

## 2. 产品形态（终态）

```
[手机 App (iOS/Android)]
      ↓ 4G/5G/WiFi（HTTPS）
[云端服务器]  ← 账号体系、任务队列、推送通知、支付、设备绑定
      ↓ 加密长连接（WebSocket/mTLS）
[客户电脑端 Agent]  ← 常驻后台，开机自启，连云端
      ↓ 本地调用
[DSH headless / Web API] → 执行任务 → 结果回传
```

---

## 3. MVP 范围（第一阶段）

**只做一件事**：手机浏览器 → 电脑上 Agent → DSH 执行 → 结果回到手机。

| 组件 | MVP 做法 | 说明 |
|---|---|---|
| 电脑端 Agent | Node.js 独立旁路程序，监听 **8788** 端口 | 8787 已被本机 Codex Relay 占用；不改动 DSH 任何配置 |
| DSH 调用 | `dsh --profile headless "任务"`（需加载 DEEPSEEK_API_KEY 用户环境变量） | 已验证可行（6.7s 返回） |
| 手机端 | 手机浏览器访问网页控制台（单页 HTML） | 先验证交互 |
| 网络 | 局域网直连 + Agent 架构预留云端接入 | 用户确认两条路都要 |
| 认证 | Bearer token（启动自动生成） | MVP 够用 |
| 安全 | 仅监听局域网；不暴露公网 | MVP 原则 |

**MVP 验收标准**：
1. 手机与电脑同一 WiFi，手机浏览器能打开控制台
2. 手机发中文指令（如"检查一下 C 盘剩余空间"）
3. DSH 实际执行（可见真实工具调用）
4. 结果完整回到手机显示
5. 会话记录可回看

---

## 4. 技术架构（MVP 明细）

```
手机浏览器
   │  http://<电脑局域网IP>:8788
   ▼
电脑端 Agent（Node.js + 原生 http）
   ├─ GET  /            → 控制台页面（内联单页 HTML）
   ├─ GET  /api/status  → Agent 健康状态
   ├─ POST /api/exec    → 下发任务 { task: "..." }
   │     └─ spawn('dsh', ['--profile','headless', task])，注入 DEEPSEEK_API_KEY
   │     └─ 等待完成，捕获 stdout（最终回答），超时 10 分钟
   ├─ GET  /api/history → 已执行任务列表（history.json）
   └─ Bearer token 认证（config.json，首次启动自动生成）
```

**已确认的技术事实**（2026-08-14 实测）：
- `dsh --profile headless "任务"` 可用，单任务约 6-7s 返回
- headless 需要 `DEEPSEEK_API_KEY`（用户级环境变量），启动脚本负责注入
- DSH web 服务监听 127.0.0.1:3080，Agent 作为旁路程序调用 headless，不冲突

---

## 5. 安全模型（分层）

| 阶段 | 措施 |
|---|---|
| MVP（局域网） | ① Bearer token；② 仅监听局域网地址；③ 启动日志留痕；④ 提示勿暴露公网 |
| 第二阶段（云端中转） | ① HTTPS；② 账号+设备绑定；③ WebSocket 长连接 + token 轮换；④ 高风险指令需电脑端确认 |
| 正式版 | ① 端到端加密（客户自持密钥）；② 审计日志；③ 指令白名单；④ 远程注销/紧急停止 |

---

## 6. 分阶段计划

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0. 方案评审 | 本方案待你批准 | 进行中 |
| 1. MVP 原型 | 电脑端 Agent + 网页控制台 + 局域网验证 | 开发中（端口已定为 8788） |
| 2. 体验增强 | 切 DSH Web API（会话连续性、历史、流式输出） | 待启动 |
| 3. 云端中转 | 云服务器 + 账号 + 加密长连接 + 推送 | 待启动 |
| 4. 产品化 | 原生 App + 上架 + 支付 + 开源 | 待启动 |

---

## 7. 风险与回滚

- 苹果审核：提前准备用途说明/演示；或先做 PWA 规避
- 端口冲突：已规避（8788）；启动前检查端口占用
- 局域网 IP 变化：启动时打印当前 IP；正式版走云端
- 安全：MVP 仅局域网 + token；云端阶段前完成安全设计评审
- 回滚：Agent 是旁路程序，删除 `Documents\phone-harness` 即回滚，DSH 零改动

---

## 8. 待确认

1. MVP 局域网直连是否按此方案推进？（建议：是）
2. 电脑端 Agent 目录 `Documents\phone-harness` 是否保留？（建议：是，可改名 deepseekharness-relay）
