# deepseekharness-relay — 项目当前状态（2026-08-14 基线）

> 本文件是给协作 Agent 的共享事实源。修改任何文件前先读本文件，避免互相覆盖。

## 已验证的核心事实

1. **电脑端 Agent**：`agent.mjs`（Node.js 原生 http，无第三方依赖），监听 `0.0.0.0:8788`，Bearer token 认证（token 存 `config.json`，首次启动自动生成）。
2. **DSH 调用**：`spawn('dsh', ['--profile','headless', task])`，单任务已验证成功（17.2s 返回"链路验证成功"）。
3. **API key**：`resolveApiKey()` 按序读取——进程环境 → Windows 注册表 `HKCU\Environment\DEEPSEEK_API_KEY` → 项目内 `.env`。已验证注册表路径有效。
4. **API 端点**：
   - `GET /` → 内联单页控制台（HTML 目前内嵌在 agent.mjs 的 INDEX_HTML）
   - `GET /api/status` → `{ok, agent, version, time}`
   - `POST /api/exec` `{task}` → `{ok, result:{ok, exitCode, stdout, stderr, elapsedMs}}`
   - `GET /api/history` → `{ok, items:[...]}`
5. **端口**：8788（8787 被本机 Codex Relay 占用，勿用）。
6. **启动**：`start-agent.ps1`（加载 User 级 DEEPSEEK_API_KEY 后 `node agent.mjs`）；后台运行用 `powershell -File start-agent.ps1`。
7. **token 认证**：所有 `/api/*` 需 `Authorization: Bearer <token>`；token 在 Agent 启动时打印，也存于 `config.json`。

## 文件归属

| 路径 | 归属 Agent | 说明 |
|---|---|---|
| `agent.mjs` | 主 Agent（A） | 核心逻辑，**B/C 不要改** |
| `start-agent.ps1` | A | 启动脚本 |
| `config.json` / `history.json` | A | 运行时数据 |
| `web/` | B | 手机网页控制台（独立文件，未来可拆出） |
| `docs/architecture/` | C | 云端接入架构设计 |
| `docs/deepseekharness-relay-方案.md` | A | 产品方案（可被 C 引用） |
| `AGENTS.md` / `.agents/` / `docs/ai-governance/` | 共享 | 治理基线，勿破坏 |

## 项目规则要点（来自 AGENTS.md）

- L3 任务（部署/迁移/密钥/删除）需明确授权；本 MVP 是本地开发，不涉及部署。
- 修改前先确认验收标准；完成后运行验证并报告。
- 不修改 `agent.mjs` 核心逻辑（除非主 Agent 明确委托）。
