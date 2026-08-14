# deepseekharness-relay 项目交接文档（上下文压缩用）

> 目的：会话上下文压缩后，新上下文读本文件即可无缝继续。更新时间：2026-08-14。
> 项目根：`C:\Users\Joey\Documents\phone-harness`（git 仓库）
> 参考 Codex 规则（subagent-driven-development SKILL "Durable Progress"）：
> 对话记忆在压缩后不保留——**信任本文件 + git log，不信任记忆**。

## 〇、恢复点（压缩后从这里继续）

**当前里程碑**：手机远程控制 DSH 的「云端(纯REST+轮询,Vercel友好) + 手机web + E2EE」代码就绪。部署目标=Vercel+Supabase(Cloudflare域名)，**不用VPS**。

**已完成并提交**：
1. **手机web** `web/cloud.html` + `e2ee-web.js`(浏览器E2EE副本)：云端地址/账号/设备配对/加密任务/解密结果/审批；CORS已加
2. **云端后端** `cloud-relay/`(纯REST，无Durable Object/WS，**可部署Vercel**)：账号/devices(配对码+公钥)/tasks(存sender_key+salt)/confirm/kill + **Agent轮询协议** `GET /v1/poll` + `POST /v1/agent/tasks/:id/result`
3. **跨端E2EE** `src/e2ee-web.js`(P-256 ECDH+HKDF+AES-GCM，纯WebCrypto，浏览器+Node通用)；Agent按任务动态派生密钥
4. **Agent云端** `src/cloud-poller.mjs`(轮询拉任务→E2EE解密→executor→加密回传，替代WS)、`src/cloud-register.mjs`(生成密钥/上报公钥/配对码)、`agent.mjs --mode=cloud`(用poller)

**E2EE约定**(改动两端须一致)：prompt AAD=`'ph-task'`，结果 AAD=taskId；salt+手机公钥(senderKey)随任务下发；Agent存本机私钥 config.cloud.e2ee.privateKey。
**测试**：`test-e2ee-web` 7/7、`test-cloud-service` 9/9、`test-core-modules` 22/22 通过。
**已验证**：Supabase 库已建、schema 已跑；设备注册/配对/创建加密任务(senderKey/salt落库) 本地能通(用真实Supabase+esbuild bundle)。

**后续（部署到Vercel，L3）**：
1. **Vercel 入口已就绪**：`cloud-relay/api/index.ts`(从process.env读SUPABASE) + `vercel.json` + `docs/DEPLOY-VERCEL.md`(全流程)
2. **关键阻塞**：本机网络连不上 `api.vercel.com` 和 `api.cloudflare.com`（都返回000）→ `vercel/wrangler` CLI 在本机无法部署。**需换能访问 api.* 的网络**（手机热点/Wi-Fi/关代理）执行 `npx vercel login` → `npx vercel env add ...` → `npx vercel --prod`；voltex 可作部署参考
3. 部署拿域名后：`phone-harness/config.json` 填 `cloud:{url,deviceId,token,e2ee.privateKey,confirmPolicy,pollIntervalMs}` → `node agent.mjs --mode=cloud`；手机 cloud.html 连域名
4. Supabase 库 tasks 表已 ALTER 补 `sender_key`,`salt` 列；service_role key 留过对话记录，建议重新生成
⚠️ 本地 wrangler dev / esbuild-bundle 起 cloud-relay 调试不稳(反复超时)；核心逻辑已被单测覆盖。部署验证前勿再在本地 dev server 上死磕。

**环境备注**：DSH(127.0.0.1:3080)队列忙时 exec 排队超时；本机 8787 被 codex-relay 占用，cloud-relay 本地用 8790/8791；curl 发 POST body 在 Miniflare 读不到(用 PowerShell/浏览器实测)。

---

## 一、项目是什么

**deepseekharness-relay**：手机远程控制电脑上 DSH（DeepSeek Harness）执行任务的产品（类 [Codex Relay](https://github.com/gronxb/codex-relay)）。
目标：抢在 DeepSeek 官方之前做出来，iOS/Android 上架，开源引流 + 收费。
架构：手机 App/网页 → （未来云端）→ 电脑端 Agent → DSH headless/Web API 执行。

## 二、当前进度（git 14 个提交）

```
43f9546 阶段3前置: 模块拆分(executor→dsh-utils+approval-relay) + 新增protocol/e2ee/guard/audit + 单测22项
cc9cd62 chore: 补充UI检查脚本与设计稿截图(design辅助资产)
fa0c726 chore: 记录运行时测试数据 + 补充PWA图标产物
c46b99e UI视觉升级接线: 助手头像+空态引导+用户气泡(完成WIP CSS→JS)
3f5a2ba P0修复: 工作区去重+路径简化+SVG图标替换emoji+加载动画
43def9c PWA黑金版图标
50a6e59 任务可视化: /api/agents(子代理列表) + 前端Agent活动页
09d365b 中断任务: /api/cancel转发DSH session.cancel
04e6598 v2升级: iOS三层导航UI + 后端同步/继续会话/流式API
05b1533 审批relay收尾
23bdb60 审批功能（WS转发+API+UI卡片）
0fd11f5 阶段2第二步（深色对话UI+会话连续性）
fc753b2 阶段2第一步（模块化拆分+双执行后端）
5c9f15e 基线 v0.2.0
```

**已完成的 MVP + 阶段2 + v2**：
- ✅ 电脑端 Agent（Node.js，8788，Bearer token）模块化：`src/{config,history,queue,executor,transport-lan}.js`
- ✅ 双执行后端：headless（lan）+ DSH Web API（both，127.0.0.1:3080，更快 3-8s）
- ✅ 会话连续性：DSH 会话复用（sessions.json 注册表），手机"继续对话"上下文记忆
- ✅ DeepSeek 风格深色对话流 UI（web/index.html，~270KB）
- ✅ v2：iOS 三层导航（项目→会话→对话）、流式打字机（/api/events kind 枚举）、继续电脑会话（/api/dsh-continue）
- ✅ 中断任务：/api/cancel 转发 DSH session.cancel
- ✅ 任务可视化：/api/agents（子代理列表）+ 前端 Agent 活动页
- ✅ 审批转发：WebSocket 连 DSH events.mux，/api/approvals，UI 审批卡片
- ✅ 会话 API：/api/sessions（GET/POST）、/api/history（?sessionId= 过滤）、/api/dsh-workspaces、/api/dsh-sessions（withCount/ungrouped）
- ✅ PWA：黑金版图标（鲸鱼+金边）+ manifest + 无缓存（Cache-Control no-store）
- ✅ UI 视觉升级接线：助手头像（asst-avatar）+ 空态引导（empty-state）+ 用户气泡蓝紫渐变
- ✅ 阶段3 前置模块拆分：executor→dsh-utils + approval-relay；新增 protocol / e2ee / guard / audit（安全基础就位，LAN 零破坏）
- ✅ 阶段3 Agent 云端传输层：src/transport/cloud.mjs（WSS 出站/hello/心跳/退避重连/outbox 回执，单测 12/12）
- ✅ 治理基线 + 云端架构文档 + DSH 反馈报告

**待做**：
- ✅ 云端骨架 `cloud-relay/`：Cloudflare Worker + RelayDO + 独立 Supabase schema 已实现（TypeScript typecheck 通过、协议一致 4/4）
- ✅ Agent 侧接线（f105c7c）：`src/cloud-service.mjs` 桥接 transport↔executor（e2ee 加密任务、guard 分级+确认、audit 记录），`agent.mjs --mode=lan|both|cloud`，单测 10/10
- 阶段3 **部署**（L3，需你主导认证，我提供代码+步骤）：独立 Supabase 建库跑 `supabase/schema.sql`；`cloud-relay` 里 `wrangler login` + 设 secret + `deploy` + 告知域名
- config.json 填 cloud 节（url/deviceId/deviceToken/e2ee/confirmPolicy）→ `node agent.mjs --mode=cloud`
- 云端 REST 完善：注册/配对配对码、任务 CRUD、confirm/kill 端点（当前 index.ts 仅健康检查/设备查询/kill 占位）
- 阶段4：App 上架、支付、多租户
- 产品化调优：审批权限预设（当前 workspace-write 下触发少）、超大 DSH 会话 history limit、通知推送

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
├── src/dsh-utils.js       # DSH RPC/事件归一化/路径工具（拆自 executor）
├── src/approval-relay.js  # 审批转发 + 会话事件流缓冲（拆自 executor）
├── src/executor.js        # 执行器+会话注册+dsh同步API（精简后）
├── src/transport-lan.js   # 8788 HTTP（含 /api/dsh-*、/api/cancel、/api/agents）
├── src/protocol.js        # 云端通信信封/消息类型/seq（阶段3，已就位）
├── src/e2ee.js            # X25519+HKDF+AES-GCM 端到端加密（阶段3，已就位）
├── src/guard.js           # 高风险指令分级+确认策略（阶段3，已就位）
├── src/audit.js           # 追加式审计日志+hash chain（阶段3，已就位）
├── src/transport/cloud.mjs # 云端传输层：WSS出站客户端+心跳+重连+outbox回执（阶段3，已就位）
├── cloud-relay/           # 云端服务骨架（Cloudflare Worker + RelayDO + 独立 Supabase schema）
├── web/index.html         # 手机控制台 UI（v2 三层导航 + 流式 + 头像/空态）
├── design/                # PWA 图标源文件 + 设计稿截图 + UI 检查脚本
├── docs/architecture/cloud-architecture.md  # 云端设计
├── docs/deepseekharness-relay-方案.md        # 产品方案
├── docs/API文档.md         # 全部端点 + kind 枚举
├── PROJECT_STATE.md       # 协作基线
└── test-*.mjs / test-core-modules.mjs / verify-v2.mjs  # 单测 + 集成验证
```
