// cloud-relay/src/index.ts —— Cloudflare Worker 入口：REST 控制面 + Agent WS 升级路由
// 路由：
//   GET  /v1/agent/ws?deviceId=xxx    —— Agent WSS 出站升级 → 路由到该设备的 RelayDO（长连接落点）
//   GET  /v1/status                   —— 健康检查
//   POST /v1/devices/:agentId/kill    —— 紧急停止（写 devices.status=killed），Agent 重连后生效
//   GET  /v1/devices/:agentId         —— 查询设备状态（绑定/在线/kill）
//   （注册/配对/任务 CRUD 由阶段3 下一步按架构文档新增）
//
// 实现骨架：不包含真实密钥/服务配置；deploy 需你本地已登录 wrangler 会话执行。

import { RelayDO } from './relay.js';
import type { Env } from './bindings.js';

export { RelayDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // ---- Agent WS 升级：路由到对应设备 RelayDO ----
    if (method === 'GET' && pathname === '/v1/agent/ws') {
      const agentId = url.searchParams.get('deviceId') || '';
      if (!agentId) {
        return json({ error: 'missing deviceId' }, 400);
      }
      const id = env.RELAY_DO.idFromName('agent:' + agentId);
      const stub = env.RELAY_DO.get(id);
      // 把升级请求转发给 DO（DO 负责 acceptWebSocket）
      return stub.fetch(request);
    }

    // ---- 健康检查 ----
    if (method === 'GET' && pathname === '/v1/status') {
      return json({ ok: true, service: 'cloud-relay', ts: new Date().toISOString() });
    }

    // ---- 紧急停止 ----
    if (method === 'POST' && pathname.startsWith('/v1/devices/') && pathname.endsWith('/kill')) {
      const agentId = decodeURIComponent(pathname.slice('/v1/devices/'.length, -'/kill'.length));
      if (!agentId) return json({ error: 'missing agentId' }, 400);
      // 骨架：直接经 DO/storage 标 killed（完整版经 store.ts 落库）
      const id = env.RELAY_DO.idFromName('agent:' + agentId);
      const stub = env.RELAY_DO.get(id);
      // 通知该设备 DO 记录 kill（若设备在线，DO 会在下次通信时拒收新任务）
      await stub.fetch(new Request('http://x/internal/kill', { method: 'POST' }));
      // 真实持久化走 Supabase（store.setDeviceStatus）——阶段3 下一步接入
      return json({ ok: true, agentId, action: 'kill' });
    }

    // ---- 查询设备状态 ----
    if (method === 'GET' && pathname.startsWith('/v1/devices/')) {
      const agentId = decodeURIComponent(pathname.slice('/v1/devices/'.length));
      if (!agentId) return json({ error: 'missing agentId' }, 400);
      const id = env.RELAY_DO.idFromName('agent:' + agentId);
      const stub = env.RELAY_DO.get(id);
      const online = await stub.fetch(new Request('http://x/internal/online?deviceId=' + encodeURIComponent(agentId)));
      const onlineBody = await online.json().catch(() => null);
      return json({ ok: true, agentId, ...(onlineBody || {}) });
    }

    return json({ error: 'not found' }, 404);
  },
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
