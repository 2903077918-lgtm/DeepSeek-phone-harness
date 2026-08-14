# deepseekharness-relay 项目交接文档（上下文压缩用）

> 目的：会话上下文压缩后，新上下文读本文件即可无缝继续。更新时间：2026-08-14。
> 项目根：`C:\Users\Joey\Documents\phone-harness`（git 仓库）

---

## 一、项目是什么

**deepseekharness-relay**：手机远程控制电脑上 DSH（DeepSeek Harness）执行任务的产品（类 [Codex Relay](https://github.com/gronxb/codex-relay)）。
目标：抢在 DeepSeek 官方之前做出来，iOS/Android 上架，开源引流 + 收费。
架构：手机 App/网页 → （未来云端）→ 电脑端 Agent → DSH headless/Web API 执行。

## 二、当前进度（git 7 个提交）

```
05b1533 审批relay收尾（清SSE死代码+修复重连退避）
23bdb60 审批功能（WS转发+API+UI卡片）
07c9018 修正UI过时文案
0fd11f5 阶段2第二步（深色对话UI+会话连续性）
fc753b2 阶段2第一步（模块化拆分+双执行后端）
5c9f15e 基线 v0.2.0
```

**已完成的 MVP + 阶段2**：
- ✅ 电脑端 Agent（Node.js，8788，Bearer token）模块化：`src/{config,history,queue,executor,transport-lan}.js`
- ✅ 双执行后端：headless（lan）+ DSH Web API（both，127.0.0.1:3080，更快 3-8s）
- ✅ 会话连续性：DSH 会话复用（sessions.json 注册表），手机"继续对话"上下文记忆
- ✅ DeepSeek 风格深色对话流 UI（web/index.html，58KB）
- ✅ 审批转发：WebSocket 连 DSH events.mux，/api/approvals，UI 审批卡片
- ✅ 会话 API：/api/sessions（GET/POST）、/api/history（?sessionId= 过滤）
- ✅ 治理基线 + 云端架构文档

**进行中（v2，Agent G/H 并行）**：
- Agent G（后端）：dsh-workspaces / dsh-sessions / dsh-continue / dsh-history / events 增量流式 API
- Agent H（UI）：iOS 三层导航（项目→会话→对话）+ 流式打字机 + 毛玻璃视觉

**待做**：
- 阶段3：云端中转（WSS+E2EE+配对，见 docs/architecture/cloud-architecture.md）
- 阶段4：App 上架、支付、多租户

## 三、关键技术结论（实测）

1. **DSH Web API**（127.0.0.1:3080，本地无鉴权）：session.create/prompt/history/list、workspace.list 可用
2. **DSH 事件流是 WebSocket**（`ws://127.0.0.1:3080/api/events.mux`），不是 SSE（fetch 返回 426）——审批和流式都靠它
3. **审批协议**：帧 {type:'server-request', rpcId, method:'approval/requested', payload:{approvalId,toolName,...}}；回传 POST /api/respond body {type:'client-response', rpcId:<帧rpcId>, result:{ok:true, value:{sessionId,approvalId,outcome:'allowed-once'|'rejected'}}}
4. **继续历史会话**：session.prompt {sessionId, mode:'queue', content:[{type:'text',text}]} 对已有会话有效（实测 voltex 会话成功）
5. **流式数据源**：WS 帧 method 含 'session/event'（assistant 增量）
6. **工作区分组缺陷**：DSH workspace.sessionIds 不动态同步，运行时新建会话显示"未分组"；重启 web 也没解决（voltex 等仍 0 会话）——**这是 DSH 自身问题，不影响 phone-harness 产品**
7. **审批触发**：当前 DSH 权限 workspace-write 下审批很少触发（方案 A：功能就位，等产品化再调权限）

## 四、运行方式

```powershell
# 启动 Agent（both 模式）
node 'C:\Users\Joey\Documents\phone-harness\agent.mjs' --mode=both
# 手机访问（Tailscale）：http://100.95.190.51:8788，token 在 config.json
# DSH web（GUI）：http://127.0.0.1:3080
```

## 五、规则（遵守）

- 全局：~/.dsh/AGENTS.md（L1/L2/L3 分级、suggestion-004 全局变更先确认）
- 项目：phone-harness/AGENTS.md + docs/ai-governance/WORKFLOW.md
- 修改前确认范围，L3 需批准，改完验证+报告，git 提交

## 六、文件结构

```
phone-harness/
├── agent.mjs              # 入口（--mode=lan|both）
├── src/config.js          # 常量/API key
├── src/history.js         # 历史
├── src/queue.js           # FIFO 队列
├── src/executor.js        # 执行器+会话注册+审批relay
├── src/transport-lan.js   # 8788 HTTP
├── web/index.html         # 手机控制台 UI
├── docs/architecture/cloud-architecture.md  # 云端设计
├── docs/deepseekharness-relay-方案.md        # 产品方案
├── PROJECT_STATE.md       # 协作基线
└── test-*.mjs             # 集成测试
```
