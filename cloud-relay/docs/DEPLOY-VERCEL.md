# cloud-relay 部署到 Vercel（Supabase + Cloudflare 域名）

> 目标：cloud-relay（纯 REST + 轮询，无 Cloudflare Durable Object）部署到 **Vercel**，数据在 **Supabase**，
> 域名用 **Cloudflare**（DNS 指向 Vercel）。Agent 走轮询（`GET /v1/poll`），不用长连接。
> ⚠️ 需在**能访问 api.vercel.com 的网络**执行（本机若连不通 api.* 会失败，请换手机热点/Wi-Fi/关代理）。

## 前置
- cloud-relay 已 esbuild/tsc 验证过；Supabase 库已建、schema 已跑，`tasks` 表已补 `sender_key`,`salt` 列
- 代码入口：`cloud-relay/api/index.ts`（Vercel Function，从 `process.env` 读 SUPABASE）、`vercel.json`

## 一、配置环境变量
Vercel 项目需要 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`（值在你 `cloud-relay/.dev.vars`）。
两种方式任选：
- 部署时命令行指定，或
- Vercel Dashboard → 项目 → Settings → Environment Variables 添加（生产/预览/开发都加上）

## 二、部署

```bash
cd C:\Users\Joey\Documents\phone-harness\cloud-relay

# 1. 登录（浏览器弹窗授权）
npx vercel login

# 2. 首次部署（它会问 link 到项目/建新项目，选 Vercel Account → Create）
npx vercel

# 3. 带生产环境变量并正式发布
npx vercel env add SUPABASE_URL production     # 输入 URL
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production   # 输入 service_role key
npx vercel --prod
```

部署成功会输出一个 `https://cloud-relay-xxxx.vercel.app`（或用你的项目别名/自定义域）。

## 三、绑定 Cloudflare 域名（可选、推荐）
cloud-relay 的 CORS 已对任意 origin 放行；如需固定域名：
1. Vercel Dashboard → 项目 → Settings → Domains → 添加你的域名（如 `relay.example.com`）
2. Cloudflare Dashboard → DNS 添加 `relay` 的 CNAME 记录 -> `cname.vercel-dns.com`（Vercel 会提示具体值）/ 或按 Vercel 给的指向
   - 按 Vercel 提示操作（通常 CNAME 到 `cname.vercel-dns.com`，或 A 记录）
3. 该域名即对外 REST地址；**Agent/手机用这个域名**

## 四、验证
```bash
# status
curl https://你的域名/v1/status
# 注册账号（验证 DB 通）
curl -X POST https://你的域名/v1/auth/register -H "content-type: application/json" -d '{"email":"you@x.com","password":"Xy#2026a"}'
```
返回 `{"ok":true,"userId":...}` 即 DB+schema+部署全部就绪。

## 五、Agent + 手机联调
1. `phone-harness/config.json` 填：
   ```json
   "cloud": { "url": "wss://你的域名/v1/agent/ws(占位,轮询用 http)", "deviceToken": "...", "e2ee": { "privateKey": "<cloud-register.mjs生成的P-256私钥>", "confirmPolicy":"high", "pollIntervalMs": 3000 } }
   ```
   `node agent.mjs --mode=cloud`
2. 手机浏览器开 `https://你的域名`（或托管 cloud.html）→ 注册/登录 → 设备配对码绑定 → 发加密任务

## 回滚 / 停止
- `cd cloud-relay && npx vercel rollback`（当前生产回滚上一版）
- Agent `--mode=lan` 即回纯局域网，不连云

## 安全提醒
- `service_role key` 权限大，只放 Vercel env / 本地，**勿提交或外发**；建议 Supabase 重新生成。
- 部署后建议收 CORS 为你的固定域名（`json()` 里 allowed origin）。
