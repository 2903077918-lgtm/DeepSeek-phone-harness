# deepseekharness-relay 项目交接文档（上下文压缩用）

> 目的：会话上下文压缩后，新上下文读本文件即可无缝继续。更新时间：2026-08-14。
> 项目根：`C:\Users\Joey\Documents\phone-harness`（git 仓库）
> 参考 Codex 规则（subagent-driven-development SKILL "Durable Progress"）：
> 对话记忆在压缩后不保留——**信任本文件 + git log，不信任记忆**。

## 〇、恢复点（压缩后从这里继续）

**当前状态**：v2 升级已全部提交；UI 视觉升级接线刚完成（git c46b99e）
- v2（三层导航+流式+继续电脑会话）、中断任务、Agent 活动页、PWA 黑金图标、工作区去重均已完成并提交
- **上次完成**：UI 视觉升级接线（助手头像 asst-avatar + 空态引导 empty-state + 用户气泡，git c46b99e，附设计资产 fa0c726/cc9cd62）
- **下一步候选**：阶段3 云端中转（WSS+E2EE+配对，见 docs/architecture/cloud-architecture.md）；手机实测最终验收
- **环境备注**：DSH web（127.0.0.1:3080）队列繁忙时（多个会话 running）exec 会排队超时——非 relay 故障，等队列清空即可

---

## 一、项目是什么

**deepseekharness-relay**：手机远程控制电脑上 DSH（DeepSeek Harness）执行任务的产品（类 [Codex Relay](https://github.com/gronxb/codex-relay)）。
目标：抢在 DeepSeek 官方之前做出来，iOS/Android 上架，开源引流 + 收费。
架构：手机 App/网页 → （未来云端）→ 电脑端 Agent → DSH headless/Web API 执行。

## 二、当前进度（git 13 个提交）

```
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
- ✅ 治理基线 + 云端架构文档 + DSH 反馈报告

**待做**：
- 阶段3：云端中转（WSS+E2EE+配对，见 docs/architecture/cloud-architecture.md）
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
├── src/executor.js        # 执行器+会话注册+审批relay+dsh同步API
├── src/transport-lan.js   # 8788 HTTP（含 /api/dsh-*、/api/cancel、/api/agents）
├── web/index.html         # 手机控制台 UI（v2 三层导航 + 流式 + 头像/空态）
├── design/                # PWA 图标源文件 + 设计稿截图 + UI 检查脚本
├── docs/architecture/cloud-architecture.md  # 云端设计
├── docs/deepseekharness-relay-方案.md        # 产品方案
├── docs/API文档.md         # 全部端点 + kind 枚举
├── PROJECT_STATE.md       # 协作基线
└── test-*.mjs / verify-v2.mjs  # 集成验证
```
