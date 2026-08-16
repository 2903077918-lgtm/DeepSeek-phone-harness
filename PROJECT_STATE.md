# deepseekharness-relay — 项目当前状态（2026-08-16）

> 本文件是给协作 Agent 的共享事实源。修改任何文件前先读本文件，避免互相覆盖。
> ⚠️ 注意：本仓库可能有多个并行会话在改（`src/dsh-utils.js`、`test-*.mjs`、`docs/` 等），提交前先 `git status` 甄别归属，只提交自己改的文件。

## 已核实的事实

1. **Agent**：`agent.mjs`（Node.js 原生 http，零第三方依赖），监听 `0.0.0.0:8788`，Bearer token 鉴权（token 存 `config.json`，gitignore）。启动：`node agent.mjs --mode=both`（LAN 8788 + 云端轮询 relay.axyntara.cn）。
2. **DSH 网关**：`127.0.0.1:3080`。HTTP RPC 信封 `{type:'client-request', rpcId, method, payload}` → `result.value`（`src/dsh-utils.js` 的 `fetchRpc`）。
   - HTTP 可用域：session.*、workspace.*、agentPreset.*、goal.*、skill.list、llm.*、**settings.describe / settings.mutate**。
   - **仅 WebSocket 可用**（HTTP 404）：messageFeedback.*、commands.list 等。
   - **settings.mutate 有版本冲突检测**：payload `{ns, ops:[{op:'set'|'unset', path:[...], value}], expectedRevision}`；冲突时需重新 describe 拿 revision 重试（executor 已自动重试一次）。
   - 关键 ns/key：`ui-conversation.busyEnter`(queue|steer)、`locale.preference`(zh|en)、`permission.defaultPreset`(workspace-write|danger-full-access)、`ui-theme.preference`(light|dark|system)、`llm-pi-ai.providers`(dict；密钥走 credentials，不进设置)。
3. **事件实时性**：agent 通过 `ws://127.0.0.1:3080/api/events.mux`（approval-relay.js）常驻接收 DSH 推送帧 → 每会话内存缓冲最近 200 条（seq 升序）。
   - 手机端：**SSE 推送** `GET /api/events.stream?sessionId=&afterSeq=`（agent 内部 250ms 查缓冲增量推送，15s 心跳），替代 800ms 轮询；打开会话即长连接跟随，发消息时暂停避免双消费，完成后恢复。
   - `GET /api/events?sessionId=&afterSeq=` 仍保留（增量轮询/水位探测）。
4. **设置读写**：`GET /api/dsh-settings`（settings.describe 关键 ns）、`POST /api/dsh-settings {ns,ops,expectedRevision}`（settings.mutate，冲突自动重试）。
5. **OCR**：`POST /api/ocr {imageBase64}` → Windows 自带 OCR（免费本地不耗 token），中文需 `[Console]::OutputEncoding=UTF8`（src/ocr.ps1）。手机发图自动转文本拼进任务。
6. **前端**：`web/relay.html`（主界面，单文件）与 `web/index.html` 保持同步（`Copy-Item` 用绝对路径！）；`web/console.html` 旧控制台归档。**relay.html 每请求读盘（no-store）**，改完即生效（无需重启 agent）；改 transport-lan.js/executor.js 后需重启 agent。
7. **视觉基准**：手机端视觉对标 DSH 桌面端截图（`C:\Users\Joey\Desktop\新建文件夹\`）——**胶囊全中性灰，单一强调蓝 #4070E0，默认深色**（DSH settings.yaml `ui-theme.preference: dark`）。不发明新配色。
8. **云端**：`cloud-relay/` Cloudflare Worker，`wrangler deploy`（经代理 127.0.0.1:7890），根路径 `/` 服务 `web/index.html`（即 relay.html）。

## 功能清单（2026-08-16）

- 对话：多轮、Markdown、分步 step 卡片、工具卡片（路径/状态/详情）、审批/提问卡、思考过程折叠
- **实时跟随**：SSE 长连接（节流渲染 4 次/秒）+ 会话状态 6s 轮询（轮/步/耗时/权限/todos）
- **设置页全功能化**：繁忙时 Enter（排队/插话，真写 DSH + 手机端排队补发）、语言（zh/en）、新会话默认权限、提供方增删改（settings.mutate）、主题（深/浅/跟随系统）、打开配置文件（/api/dsh-config → 编辑器）
- **会话操作面板**：触屏 ⋮ / 长按 / 右键 → 分支/重命名/删除
- **轨迹面板**：对话/轨迹切换，ASSISTANT/TOOL 时间线 + 搜索 + Duration 列（消息时间戳差）
- 抽屉：新会话/工作区/会话（相对时间 + 展开其余）/更多功能折叠/设置
- 空状态：预览版 + 探索未至之境 + 描述 + 可点击 chips（模式/权限/模型）
- 任务清单可收起展开；OCR 图片→文本；主题切换；模型/模式切换（会话锁定时仅新建）

## 已知边界

- 权限切换：HTTP 无权限 RPC（5 个方法 404）→ 当前会话权限仅展示（点胶囊弹面板说明）；只能改"新会话默认权限"。
- 消息赞/踩、commands：WS-only，未实现（需 DSH WebSocket-Remote 客户端，高成本）。
- 轨迹 Duration 为消息级估算（无 step 级时间戳）。
