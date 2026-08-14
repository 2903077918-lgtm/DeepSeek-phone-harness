// cloud-relay/src/index.ts —— Cloudflare Worker 入口：REST 控制面 + Agent WS 升级路由
// 路由：
//   Agent WS : GET /v1/agent/ws?deviceId=xxx           → 路由到该设备 RelayDO（长连接落点）
//   账号      : POST /v1/auth/register|login
//   设备      : POST /v1/devices/register（Agent生成配对码） / POST /v1/devices/:agent/pair
//               GET /v1/devices/:agent                 / POST /v1/devices/:agent/kill
//   任务      : POST /v1/tasks（创建+推Agent）          / GET /v1/tasks?deviceId=
//               GET /v1/tasks/:id                      / GET /v1/tasks/:id/events
//               POST /v1/tasks/:id/confirm|cancel
//   misc      : GET /v1/status
//
// 需要 env：SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY（wrangler secret）；未配置时 store 操作返回 503。
// 实现含真实业务逻辑但**未部署、不含密钥**；deploy 由你本地已登录 wrangler 会话执行（L3）。

import { RelayDO } from './relay.js';
import { createSupabase } from './supabase.js';
import {
  upsertDevice, setDeviceStatus, createTask, updateTaskStatus, appendTaskEvent, appendAudit,
  createUser, loginUser, generatePairCode, createPairCode, pairDeviceWithCode,
  listTasks, getTaskById, listTaskEvents, getDeviceByAgentId,
} from './store.js';
import type { Env } from './bindings.js';

export { RelayDO };

// 当前请求的 Origin（CORS；按请求同步赋值，JSON 响应同步构造，无并发覆盖）
let reqOrigin: string | null = null;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    reqOrigin = request.headers.get('Origin');
    const origin = reqOrigin;

    // CORS 预检直接放行（204 无 body，单独构造）
    if (method === 'OPTIONS') {
      const res = new Response(null, { status: 204 });
      if (origin) {
        res.headers.set('Access-Control-Allow-Origin', origin);
        res.headers.set('Vary', 'Origin');
        res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.headers.set('Access-Control-Allow-Headers', 'content-type, x-user-id, authorization');
      }
      return res;
    }

    const db = method === 'GET' && pathname.startsWith('/v1/agent/ws') ? null
      : createDb(env); // 懒建（WS 升级不需要 DB）

    // Agent WS 升级：不适用 CORS
    if (method === 'GET' && pathname === '/v1/agent/ws') {
      const agentId = url.searchParams.get('deviceId') || '';
      if (!agentId) return json({ error: 'missing deviceId' }, 400, origin);
      const stub = env.RELAY_DO.get(env.RELAY_DO.idFromName('agent:' + agentId));
      return stub.fetch(request);
    }
    if (method === 'GET' && pathname === '/v1/status') {
      return json({ ok: true, service: 'cloud-relay', ts: new Date().toISOString() }, 200, origin);
    }

    // 以下需要 DB；未配置 Supabase 则提示
    if (!db) return json({ error: 'Supabase 未配置', hint: 'wrangler secret put SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' }, 500, origin);

    // ---- 账号 ----
    if (method === 'POST' && pathname === '/v1/auth/register') {
      const { email, password } = await readJson(request);
      if (!email || !password) return json({ error: 'email/password 必填' }, 400);
      try {
        const u = await createUser(db, String(email), String(password));
        return json({ ok: true, userId: u.id });
      } catch (e) { return json({ error: '注册失败: ' + String(e) }, 409); }
    }
    if (method === 'POST' && pathname === '/v1/auth/login') {
      const { email, password } = await readJson(request);
      const u = await loginUser(db, String(email), String(password));
      if (!u) return json({ error: '邮箱或密码错误' }, 401);
      return json({ ok: true, userId: u.id, email: u.email });
    }

    // ---- 设备注册（Agent hello 走这里：upsert + 生成配对码）----
    if (method === 'POST' && pathname === '/v1/devices/register') {
      try {
        const body = await readJson(request);
        const agentId = String(body.agentId || '');
        if (!agentId) return json({ error: 'agentId 必填' }, 400);
        await upsertDevice(db, agentId, {
          name: body.name, os: body.os, arch: body.arch, version: body.version, publicKeyX25519: body.publicKey,
        });
        const { code, codeHash } = await generatePairCode();
        await createPairCode(db, agentId, codeHash);
        await appendAudit(db, { deviceId: agentId, action: 'device.register' });
        return json({ ok: true, deviceId: agentId, pairCode: code }); // 明文配对码只此一次返回给 Agent
      } catch (e) {
        return json({ ok: false, error: '设备注册失败: ' + String(e) }, 500);
      }
    }

    // ---- 设备配对（手机绑定 user↔device）----
    if (method === 'POST' && pathname.startsWith('/v1/devices/') && pathname.endsWith('/pair')) {
      const agentId = decodeURIComponent(pathname.slice('/v1/devices/'.length, -'/pair'.length));
      const { pairCode, userId } = await readJson(request);
      if (!agentId || !pairCode || !userId) return json({ error: 'agentId/pairCode/userId 必填' }, 400);
      const r = await pairDeviceWithCode(db, agentId, String(pairCode), String(userId));
      if (!r.ok) return json({ error: r.error }, 400);
      await appendAudit(db, { userId: String(userId), deviceId: agentId, action: 'device.pair' });
      return json({ ok: true });
    }

    // ---- 设备查询 / 紧急停止 ----
    if (method === 'GET' && pathname.startsWith('/v1/devices/')) {
      const agentId = decodeURIComponent(pathname.slice('/v1/devices/'.length));
      if (!agentId) return json({ error: 'missing agentId' }, 400);
      const dev = await getDeviceByAgentId(db, agentId);
      return dev
        ? json({ ok: true, device: { agentId, status: dev.status, bound: !!dev.user_id, lastSeen: dev.last_seen_at, killUntil: dev.kill_until } })
        : json({ ok: false, error: '设备不存在' }, 404);
    }
    if (method === 'POST' && pathname.startsWith('/v1/devices/') && pathname.endsWith('/kill')) {
      const agentId = decodeURIComponent(pathname.slice('/v1/devices/'.length, -'/kill'.length));
      const dev = await getDeviceByAgentId(db, agentId);
      if (!dev) return json({ error: '设备不存在' }, 404);
      await setDeviceStatus(db, dev.id, 'killed');
      // 通知该设备 DO（若在线，RelayDO 拒绝新任务）
      await env.RELAY_DO.get(env.RELAY_DO.idFromName('agent:' + agentId)).fetch(new Request('http://x/internal/kill', { method: 'POST' }));
      await appendAudit(db, { deviceId: agentId, action: 'device.kill' });
      return json({ ok: true, agentId, action: 'kill' });
    }

    // ---- 任务 ----
    if (method === 'POST' && pathname === '/v1/tasks') {
      const body = await readJson(request);
      const { deviceId, userId, promptCipher, requireConfirm, riskLevel, timeoutMs } = body;
      if (!deviceId || !promptCipher) return json({ error: 'deviceId/promptCipher 必填' }, 400);
      const dev = await getDeviceByAgentId(db, String(deviceId));
      if (!dev || !dev.user_id) return json({ error: '设备不存在或未绑定' }, 404);
      if (dev.status === 'killed') return json({ error: '设备已 kill，拒绝新任务' }, 403);
      const task = await createTask(db, {
        userId: String(userId || dev.user_id), deviceId: String(deviceId),
        promptCipher, riskLevel, requireConfirm, timeoutMs, 
      });
      await appendTaskEvent(db, task.id, 'task.created', {});
      // 通知 RelayDO 下发到 Agent
      await env.RELAY_DO.get(env.RELAY_DO.idFromName('agent:' + deviceId))
        .fetch(new Request('http://x/internal/submit', {
          method: 'POST',
          body: JSON.stringify({ taskId: task.id, promptCipher, requireConfirm, riskLevel, timeoutMs }),
        }));
      return json({ ok: true, taskId: task.id }, 201);
    }
    if (method === 'GET' && pathname === '/v1/tasks') {
      const items = await listTasks(db, {
        deviceId: url.searchParams.get('deviceId') || undefined,
        userId: url.searchParams.get('userId') || undefined,
        status: url.searchParams.get('status') || undefined,
        limit: Number(url.searchParams.get('limit') || '' ) || undefined,
      });
      return json({ ok: true, items });
    }
    if (method === 'GET' && pathname.startsWith('/v1/tasks/') && pathname.endsWith('/events')) {
      const taskId = decodeURIComponent(pathname.slice('/v1/tasks/'.length, -'/events'.length));
      const events = await listTaskEvents(db, taskId);
      return json({ ok: true, items: events });
    }
    if (method === 'GET' && pathname.startsWith('/v1/tasks/')) {
      const taskId = decodeURIComponent(pathname.slice('/v1/tasks/'.length));
      const t = await getTaskById(db, taskId);
      return t ? json({ ok: true, task: t }) : json({ ok: false, error: '任务不存在' }, 404);
    }
    if (method === 'POST' && pathname.startsWith('/v1/tasks/') && pathname.endsWith('/confirm')) {
      const taskId = decodeURIComponent(pathname.slice('/v1/tasks/'.length, -'/confirm'.length));
      const { decision, userId } = await readJson(request);
      if (decision !== 'allow' && decision !== 'deny') return json({ error: 'decision 只能 allow/deny' }, 400);
      const t = await getTaskById(db, taskId);
      if (!t) return json({ error: '任务不存在' }, 404);
      await updateTaskStatus(db, taskId, decision === 'allow' ? 'running' : 'cancelled');
      await appendTaskEvent(db, taskId, decision === 'allow' ? 'task.confirmed' : 'task.denied', { userId });
      // 通知 Agent 确认结果
      if (t.device_id) {
        await env.RELAY_DO.get(env.RELAY_DO.idFromName('agent:' + t.device_id)).fetch(new Request('http://x/internal/confirm', {
          method: 'POST', body: JSON.stringify({ taskId, decision }),
        }));
      }
      return json({ ok: true, taskId, decision });
    }
    if (method === 'POST' && pathname.startsWith('/v1/tasks/') && pathname.endsWith('/cancel')) {
      const taskId = decodeURIComponent(pathname.slice('/v1/tasks/'.length, -'/cancel'.length));
      const t = await getTaskById(db, taskId);
      if (!t) return json({ error: '任务不存在' }, 404);
      await updateTaskStatus(db, taskId, 'cancelled');
      await appendTaskEvent(db, taskId, 'task.cancelled', {});
      if (t.device_id) {
        await env.RELAY_DO.get(env.RELAY_DO.idFromName('agent:' + t.device_id)).fetch(new Request('http://x/internal/cancel', {
          method: 'POST', body: JSON.stringify({ taskId }),
        }));
      }
      return json({ ok: true, taskId });
    }

    return json({ error: 'not found' }, 404);
  },
};

function createDb(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  // 已判空，构造 SupabaseEnv
  const supaEnv = { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY };
  return createSupabase(supaEnv);
}

function json(data: unknown, status = 200, origin?: string | null): Response {
  const o = origin !== undefined ? origin : reqOrigin;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (o) {
    headers['Access-Control-Allow-Origin'] = o;
    headers['Vary'] = 'Origin';
    headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'content-type, x-user-id, authorization';
  }
  return new Response(JSON.stringify(data), { status, headers });
}

async function readJson(request: Request): Promise<Record<string, any>> {
  let text = '';
  try { text = await request.text(); } catch { /* body 不可读 */ }
  if (!text || !text.trim()) return {};
  try {
    const v = JSON.parse(text);
    return (v && typeof v === 'object') ? v : { raw: text };
  } catch {
    return { raw: text };
  }
}
