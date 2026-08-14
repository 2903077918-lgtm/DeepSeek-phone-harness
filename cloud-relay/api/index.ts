// cloud-relay/api/index.ts —— Vercel Function 入口（部署到 Vercel）
// 把 cloud-relay 的 fetch handler 适配为 Vercel Function：从 process.env 读取 Supabase 连接。
// Vercel 部署要求：
//   1. vercel CLI 登录后 `vercel --prod`
//   2. 在 Vercel 项目 Environment Variables 配 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY
import cloudRelay from '../src/index.js';

// @ts-ignore 项目 tsconfig types=workers-types；Vercel Node 运行时才有 process，这里用全局弱类型访问
declare const process: { env: Record<string, string | undefined> } | undefined;

export default async function handler(request: Request): Promise<Response> {
  const supabaseUrl = process?.env?.SUPABASE_URL;
  const supabaseKey = process?.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未配置' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  const env = { SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: supabaseKey };
  return cloudRelay.fetch(request, env);
}
