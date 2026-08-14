# cloud-relay 部署指南（Supabase + Cloudflare）

> 这是 **L3 部署**，需要你用自己已登录的账号在浏览器/CLI 执行。我不读取/提交任何密钥；
> 你执行后把**非敏感信息**（域名、project-ref）告诉我即可继续联调。
>
> 前置：已按 `README.md` 装好 `cloud-relay` 依赖（`npm install` 后 `npx wrangler` 可用）。

---

## 第 1 步：建独立 Supabase 数据库（我无法代劳——需你的网页账号）

1. 打开 https://supabase.com → 登录（用 voltex 同账号即可，或建独立 work 区）
2. **新建项目**（New project）：
   - Region：选离你近的（Tokyo / Singapore 等）
   - 数据库口令：自定，**记下但别提交**
   - 项目名：`cloud-relay`（独立库，**不要复用 voltex 的库**）
3. 项目创建后进入 Dashboard，左侧 **SQL Editor** → New query：
   - 打开本项目 `cloud-relay/supabase/schema.sql`，把**全部内容**粘贴进 SQL Editor → **Run**
   - 应看到 7 张表 + 若干索引/RLS 成功执行
4. 拿两个 key（**只在本机 `cloud-relay/.dev.vars` 用，绝不提交**）：
   - 左侧 **Project Settings → API**
   - `Project URL`（形如 `https://xxxx.supabase.co`）
   - `service_role key`（**secret**，只 server 端用；别用 anon key）

> 校验：SQL Editor 里 `select count(*) from public.devices;` 应返回 0。
> 若 RLS 拦住 service_role 查询，说明 `alter table ... enable row level security` 生效（service_role 不受限）。

---

## 第 2 步：配置云端 secret（Cloudflare）

在 `cloud-relay/` 目录执行（用你已登录的 account）：

```bash
cd C:\Users\Joey\Documents\phone-harness\cloud-relay

# 登录（浏览器弹窗授权）
npx wrangler login

# 写入 Supabase 连接（值在 .dev.vars 也可，生产建议 secret）
npx wrangler secret put SUPABASE_URL        # 粘贴 Project URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # 粘贴 service_role key
```

本地调试可选：新建 `cloud-relay/.dev.vars`（已被 .gitignore 忽略，别提交）：
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

---

## 第 3 步：本地试跑 Worker

```bash
cd C:\Users\Joey\Documents\phone-harness\cloud-relay
npx wrangler dev
```

浏览器开 `http://127.0.0.1:8788/v1/status`（wrangler dev 端口可能不同，看输出）→ 应返回 `{"ok":true}`。
注册一个账号验证 DB 通：
```bash
curl -X POST http://127.0.0.1:8788/v1/auth/register -H "content-type: application/json" \
  -d '{"email":"you@example.com","password":"test1234"}'
```
返回 `{"ok":true,"userId":"..."}` 即 DB 与 schema 全部就绪。

---

## 第 4 步：部署 Cloudflare Worker

```bash
cd C:\Users\Joey\Documents\phone-harness\cloud-relay
npx wrangler deploy
```

输出会给一个 `workers.dev` 域名（或你绑定的自定义域名）。把最终访问地址（如
`https://cloud-relay.你的域名.workers.dev` 或自定义域）告诉本项目负责人，用于后续 Agent/手机联调。

**自定义域名（可选、推荐）**：在 Cloudflare Dashboard → 该 Worker → Settings → Domains → Add
绑定你的二级域名（如 `relay.example.com`），然后 TLS 自动。

---

## 第 5 步：Agent 接云端（phone-harness `--mode=cloud`）

在 `phone-harness/config.json` 增加（deviceToken 是 Agent 自生成的设备令牌；deviceId 稳定即可；
e2ee 是手机↔Agent 共享密钥绑定后填）：

```json
{
  "token": "既有 LAN token…",
  "cloud": {
    "url": "wss://RELAY_DOMAIN/v1/agent/ws",      // 用第 4 步的最终域名（ws→wss）
    "deviceId": "your-pc-agent",
    "deviceToken": "<agent 自生成的 24h 令牌>",
    "resumeToken": null,
    "confirmPolicy": "high"
  }
}
```

启动：
```bash
node agent.mjs --mode=cloud
```
Agent 会:WSS 出站连云端 → 上报 `agent.hello` → 手机注册后配对 → 收 `task.submit` 执行。

---

## 回滚 / 停止

- **云端**：`cd cloud-relay && npx wrangler delete --name cloud-relay` 即整体下线（本地 Agent 不受影响）。
- **Agent**：`--mode=lan` 即回到纯局域网（不连云），`config.json` 删掉 `cloud` 节即彻底不连。
- **Supabase**：删项目即数据随删（注意：这是不可逆的，慎用，只在需要重置时）。

## 安全须知

- `service_role key` 拥有库的全部权限——**只放 wrangler secret / .dev.vars，绝不提交或发给第三方**。
- 本项目仓库的 `.env*` / `.dev.vars` 已在 `.gitignore` 忽略。
- 阶段3 单用户自用已够；上多租户前需按 user_id 收紧 RLS（schema 已有占位 policy）。
