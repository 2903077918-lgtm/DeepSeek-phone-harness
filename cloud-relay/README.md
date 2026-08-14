# cloud-relay —— deepseekharness-relay 云端（控制面 + WS 网关）

WebSocket 网关（Cloudflare Worker + Durable Object）+ 独立 Supabase 数据库。
**Agent 永远出站连云端**，云端只做控制面与中继，任务内容 E2EE（云端不可读）。

> 这是**实现骨架**：不含真实密钥/服务配置，未部署。部署由你在已登录 `wrangler` 的会话执行（L3）。

## 架构（对应 docs/architecture/cloud-architecture.md）

```
手机 App/网页(client) ──REST/WSS──▶ Cloudflare Worker（控制面）
                                     ├─ RelayDO（Durable Object）
                                     │   每设备一个 = Agent WSS 出站长连接落点
                                     │   + 任务队列 + 消息透传 + kill/confirm
                                     ▼
                                  Supabase（独立数据库）
                                     users / devices / tasks(tokens) / audit
```

- **WS 长连接只能存活在 Durable Object**：Agent 连 `/v1/agent/ws?deviceId=…` → Worker 按 `idFromName('agent:'+deviceId)` 路由到对应 `RelayDO`。
- 消息信封与 Agent `src/protocol.js` **逐字一致**（见 `src/protocol.ts`，防漂移）。

## 目录

```
src/
  index.ts       Worker 入口（REST 控制面 + WS 升级路由）
  relay.ts       RelayDO：Agent WS 落点 + 队列 + 消息分发（Hibernation API）
  protocol.ts    协议信封/消息类型（与 Agent src/protocol.js 一致）
  supabase.ts    轻量 fetch 版 PostgREST 客户端（零第三方依赖）
  store.ts       数据访问层（devices/tasks/tokens/audit）
  types.ts       云端实体类型
  bindings.ts    Worker 环境绑定/secret
supabase/
  schema.sql     独立 Supabase 数据库 DDL
```

## 本地开发

```bash
npm install
# 本地起 dev server（无需真实 Supabase/CF，协议单测可离线跑）
npm run typecheck
```

## 需要你提供（L3 部署时）

1. **Supabase**：新建一个独立数据库项目（不要复用 voltex 的库）→ 在 SQL Editor 执行 `supabase/schema.sql` → 拿到 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
2. **Cloudflare**：`npx wrangler login`（你的已登录会话），把 URL/key 设为 secret：
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler deploy
   ```
3. **域名**：绑定 `/v1/agent/ws`、`/v1/*` 到你的 CF 域名（我部署时需要你告知确切域名）
4. Agent 侧接线（phone-harness）：把 `src/transport/cloud.mjs` 连到云端 URL

## 密钥安全

本仓库不含任何真实密钥。`.env*` / `.dev.vars*` / wrangler secret 全在部署端，我不会读取或提交。
