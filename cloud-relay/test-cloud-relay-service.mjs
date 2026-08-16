// test-cloud-relay-service.mjs —— 云端服务(REST 控制面)服务端单测
// 覆盖 cloud-relay/src/index.ts 的 fetch handler + store.ts + supabase.ts：账号 / 设备注册 / 配对 /
// 任务 CRUD(E2EE senderKey/salt) / poll / confirm / cancel / kill / result / CORS。
// 不连真实 Supabase：把 store 依赖的 PostgREST(fetch) 换成内存 mock，跑真实业务逻辑。
// 运行（须在 cloud-relay 目录，用自定义 loader 解析 .ts 源码中的 .js 后缀导入）：
//   node --loader ./test-utils/ts-import-loader.mjs --experimental-strip-types test-cloud-relay-service.mjs
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond });
  console.log((cond ? '✅' : '❌'), name, detail ? '| ' + detail : '');
}
async function req(handler, method, path, body, origin = null, extraHeaders = {}) {
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  if (origin) headers.origin = origin;
  const r = new Request('https://relay.test' + path, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handler.fetch(r, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'sd_ro' });
}

// ---------- 内存 PostgREST mock（替代真实 Supabase 网络） ----------
function createMemDb() {
  const tables = { users: [], devices: [], pair_codes: [], tasks: [], task_events: [], audit_log: [], tokens: [] };
  const uuid = () => crypto.randomUUID();

  function matchesFilter(row, key, value) {
    if (typeof value !== 'string' || !value.startsWith('eq.')) return true; // order/limit 等忽略
    const raw = value.slice(3);
    const got = row[key];
    if (got == null) return false;
    return String(got) === raw;
  }

  return {
    tables,
    async fetch(url, init = {}) {
      const u = new URL(url);
      const parts = u.pathname.replace(/^\//, '').split('/'); // ['rest','v1','<table>']
      const table = parts[2];
      const method = (init.method || 'GET').toUpperCase();
      const t = this.tables[table];
      if (!t) return jsonR({ error: 'no table ' + table }, 404);

      if (method === 'GET') {
        const qs = Object.fromEntries(u.searchParams.entries());
        const filterKeys = Object.keys(qs).filter((k) => String(qs[k]).startsWith('eq.'));
        let rows = t.filter((row) => filterKeys.every((k) => matchesFilter(row, k, qs[k])));
        const order = qs.order || '';
        if (order.startsWith('created_at.')) rows = [...rows].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
        const limit = Number(qs.limit || '') || rows.length;
        return jsonR(rows.slice(0, limit));
      }
      if (method === 'POST') {
        const row = JSON.parse(init.body || '{}');
        if (!row.id) row.id = uuid();
        t.push(row);
        return jsonR([row], 201);
      }
      if (method === 'PATCH') {
        const idCol = new URL(url).searchParams.keys().next().value || 'id';
        const idVal = new URL(url).searchParams.get(idCol);
        const raw = String(idVal || '').startsWith('eq.') ? String(idVal).slice(3) : idVal;
        const patch = JSON.parse(init.body || '{}');
        const idx = t.findIndex((r) => String(r[idCol] ?? r.id) === raw);
        if (idx < 0) return jsonR([], 200);
        Object.assign(t[idx], patch);
        return jsonR([t[idx]], 200);
      }
      return jsonR({ error: 'unsupported' }, 405);
    },
  };
}
function jsonR(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

// 安装内存 mock；保留真实 Response/Request（Node 全局已有）。
const realFetch = globalThis.fetch;
const mem = createMemDb();
globalThis.fetch = (input, init) => {
  // 只劫持 PostgREST 请求（rest/v1）；其余交给真实 fetch（测试里不会出现其他外呼）
  const url = new URL(typeof input === 'string' ? input : String(input));
  if (url.pathname.includes('/rest/v1/')) return mem.fetch(url, init || {});
  return realFetch(input, init);
};
const cloudRelay = (await import('./src/index.ts')).default;

// ---------- 1. 健康/路由/CORS ----------
(async () => {
  const s = await req(cloudRelay, 'GET', '/v1/status');
  const sj = await s.json();
  check('GET /v1/status 200 ok', sj.ok === true && s.status === 200);

  const nf = await req(cloudRelay, 'GET', '/v1/illegal-route');
  check('未知路由 → 404', nf.status === 404);

  const preflight = await cloudRelay.fetch(
    new Request('https://relay.test/v1/tasks', { method: 'OPTIONS', headers: { origin: 'https://phone.app' } }),
    { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y' },
  );
  check('CORS 预检 204 + 头', preflight.status === 204 && !!preflight.headers.get('Access-Control-Allow-Origin') && preflight.headers.get('Access-Control-Allow-Origin') === 'https://phone.app');

  const noDb = await cloudRelay.fetch(new Request('https://relay.test/v1/poll?deviceId=d'), {});
  check('Supabase 未配置 → 500 提示', noDb.status === 500);

  // ---------- 2. 账号注册 + 登录 ----------
  let r = await req(cloudRelay, 'POST', '/v1/auth/register', { email: 'a@b.com', password: 'secret123' });
  let j = await r.json();
  check('POST /v1/auth/register 成功', r.status === 200 && !!j.userId, 'userId=' + (j.userId || '').slice(0, 8));

  r = await req(cloudRelay, 'POST', '/v1/auth/register', { email: 'a@b.com', password: 'x' });
  check('重复注册 → 409', r.status === 409);

  r = await req(cloudRelay, 'POST', '/v1/auth/login', { email: 'a@b.com', password: 'wrong' });
  check('登录错误密码 → 401', r.status === 401);

  r = await req(cloudRelay, 'POST', '/v1/auth/login', { email: 'a@b.com', password: 'secret123' });
  j = await r.json();
  check('登录正确密码 → 200 带 email', r.status === 200 && j.email === 'a@b.com');

  // ---------- 3. 设备注册 + 配对 ----------
  r = await req(cloudRelay, 'POST', '/v1/devices/register', { agentId: 'agent_pc', name: 'PC', os: 'win', publicKey: 'pubkey1' });
  j = await r.json();
  check('POST /v1/devices/register → pairCode', r.status === 200 && /^[A-Z2-9]{8}$/.test(j.pairCode), 'code=' + j.pairCode);
  const pairCode = j.pairCode;

  r = await req(cloudRelay, 'POST', '/v1/devices/agent_pc/pair', { pairCode: 'XXXXXXXX', userId: 'u1' });
  check('错误配对码 → 400', r.status === 400);

  r = await req(cloudRelay, 'POST', '/v1/devices/agent_pc/pair', { pairCode, userId: 'u1' });
  check('正确配对码 → 200 绑定', r.status === 200);

  r = await req(cloudRelay, 'GET', '/v1/devices/agent_pc');
  j = await r.json();
  check('设备查询 bound=true', j.ok === true && j.device.bound === true, 'bound=' + j.device.bound);

  // ---------- 4. 任务创建（E2EE senderKey/salt 落库）+ 轮询 ----------
  r = await req(cloudRelay, 'POST', '/v1/tasks', { deviceId: 'agent_pc', promptCipher: { ciphertext: 'C0', nonce: 'n0', tag: 't0' }, senderKey: 'phonePub', salt: 'saltX' });
  j = await r.json();
  check('已绑定设备创建任务 → 201', r.status === 201 && !!j.taskId);
  const taskId = j.taskId;

  r = await req(cloudRelay, 'POST', '/v1/tasks', { deviceId: 'unbound_dev', promptCipher: { ciphertext: 'C', nonce: 'n', tag: 't' } });
  check('未绑定设备创建任务 → 404', r.status === 404);

  r = await req(cloudRelay, 'GET', '/v1/poll?deviceId=agent_pc');
  j = await r.json();
  const queued = (j.tasks || []).find((t) => t.id === taskId);
  check('poll 返回 queued 任务 + E2EE 字段', j.ok === true && !!queued && queued.sender_key === 'phonePub' && queued.salt === 'saltX', 'sender_key=' + queued?.sender_key);

  r = await req(cloudRelay, 'GET', '/v1/tasks/' + taskId);
  j = await r.json();
  check('任务详情含 E2EE 密文', j.ok === true && j.task.status === 'queued' && j.task.prompt_cipher?.ciphertext === 'C0');

  // ---------- 5. confirm：allow → running；deny → cancelled ----------
  r = await req(cloudRelay, 'POST', '/v1/tasks/not-exist/confirm', { decision: 'allow' });
  check('confirm 不存在任务 → 404', r.status === 404);

  r = await req(cloudRelay, 'POST', '/v1/tasks/' + taskId + '/confirm', { decision: 'bogus' });
  check('非法 decision → 400', r.status === 400);

  r = await req(cloudRelay, 'POST', '/v1/tasks/' + taskId + '/confirm', { decision: 'allow' });
  check('confirm allow → 200', r.status === 200);
  r = await req(cloudRelay, 'GET', '/v1/tasks/' + taskId);
  j = await r.json();
  check('confirm 后任务 running', j.task.status === 'running');

  // ---------- 6. result 回传（Agent）----------
  r = await req(cloudRelay, 'POST', '/v1/agent/tasks/' + taskId + '/result', { status: 'succeeded', result_cipher: { ciphertext: 'R1', iv: 'i', tag: 'tg' }, elapsedMs: 1200, exitCode: 0 });
  check('POST result → 200', r.status === 200);
  r = await req(cloudRelay, 'GET', '/v1/tasks/' + taskId);
  j = await r.json();
  check('终态 succeeded + result_cipher 落库', j.task.status === 'succeeded' && j.task.result_cipher?.ciphertext === 'R1' && j.task.elapsed_ms === 1200);

  // 事件回放
  r = await req(cloudRelay, 'GET', '/v1/tasks/' + taskId + '/events');
  j = await r.json();
  check('任务事件回放 ≥ 3（created/confirmed/succeeded）', j.ok === true && Array.isArray(j.items) && j.items.length >= 3, 'events=' + (j.items || []).length);

  // ---------- 7. cancel + kill ----------
  r = await req(cloudRelay, 'POST', '/v1/tasks/' + taskId + '/cancel');
  r = await req(cloudRelay, 'GET', '/v1/tasks/' + taskId);
  j = await r.json();
  check('已终态任务 cancel 仍可(幂等) 200', r.status === 200);

  r = await req(cloudRelay, 'POST', '/v1/devices/agent_pc/kill');
  check('device kill → 200', r.status === 200);
  r = await req(cloudRelay, 'POST', '/v1/tasks', { deviceId: 'agent_pc', promptCipher: { ciphertext: 'Cd', nonce: 'n', tag: 't' } });
  check('被 kill 设备拒收新任务 → 403', r.status === 403);

  // ---------- 8. 未配置 DB 时仍可访问 status ----------
  const noDbStatus = await cloudRelay.fetch(new Request('https://relay.test/v1/status'), {});
  check('无 DB 也能用 /v1/status', noDbStatus.status === 200);

  globalThis.fetch = realFetch;
  console.log('\n===== 汇总 =====');
  const passed = results.filter((x) => x.ok).length;
  console.log(`${passed}/${results.length} 通过`);
  if (passed < results.length) {
    results.filter((x) => !x.ok).forEach((x) => console.log('  -', x.name));
    process.exit(1);
  }
})();
