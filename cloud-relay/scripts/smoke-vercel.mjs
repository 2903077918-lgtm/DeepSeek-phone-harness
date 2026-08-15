// scripts/smoke-vercel.mjs —— 本地冒烟：调用 dist/runtime/api/index.js 的 handler，验证函数逻辑可跑
// 用法（在 cloud-relay 目录下）: node scripts/smoke-vercel.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const dv = await readFile('.dev.vars', 'utf8');
const url = (dv.match(/SUPABASE_URL=(.+)/) || [])[1]?.trim();
const key = (dv.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/) || [])[1]?.trim();

// 模拟 Vercel 运行时注入的 process.env
process.env.SUPABASE_URL = url;
process.env.SUPABASE_SERVICE_ROLE_KEY = key;

const mod = await import(pathToFileURL(join(process.cwd(), 'dist', 'runtime', 'api', 'index.js')).href);
const handler = mod.default?.default ?? mod.default; // CJS: module.exports.default；ESM: default
if (typeof handler !== 'function') { console.error('no handler'); process.exit(1); }

const call = async (path, method = 'GET', body = undefined) => {
  const req = new Request('https://local.test' + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const env = { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key };
  const res = await handler(req, env);
  const text = await res.text();
  console.log(`[${method}] ${path} -> HTTP ${res.status} ${text.slice(0, 200)}`);
  return res;
};

console.log('env url set:', !!url, '| key set:', !!key);
await call('/v1/status');
await call('/v1/auth/register', 'POST', { email: 'probe@smoke.local', password: 'Xy#2026a' });
