// src/executor.js —— 任务执行器（headless 后端 + Web API 后端可选）
// 抽象：executor.run(task, {sessionId}, onDelta) → Promise<result>
// 后端选择：mode=lan 用 headless（默认）；mode=both 时 headless 保底、Web API 优先
// 会话连续性：Web API 后端维护 sessionId 注册表（sessions.json 持久化，重启可恢复）；
//   run 时复用调用方指定会话（或最近使用的现有会话），DSH 因此保留多轮上下文。
// 审批转发：createApprovalRelay 常驻监听 DSH /api/events.mux 的 approval/requested 事件，
//   把审批结果回传到 /api/respond；executor 附加懒创建的 relay 单例供 transport 使用。
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DSH_CMD, TASK_TIMEOUT_MS, resolveApiKey } from './config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const API_KEY = resolveApiKey(ROOT_DIR);
const WEB_API_BASE = 'http://127.0.0.1:3080';
const MAX_REGISTERED_SESSIONS = 100; // 注册表上限，超出按 lastUsedAt 淘汰最旧

// ---- headless 后端（保底，已验证可用）----
function runHeadless(task, onDelta) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (!env.DEEPSEEK_API_KEY && API_KEY) env.DEEPSEEK_API_KEY = API_KEY;
    const started = Date.now();
    const child = spawn(DSH_CMD, ['--profile', 'headless', task], { env, shell: true });
    let stdout = '', stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        } else {
          child.kill('SIGKILL');
        }
      } catch { /* already gone */ }
      finish({ ok: false, exitCode: -1, stdout: stdout.trim(), stderr: (stderr + '\n[超时] 任务超过 ' + TASK_TIMEOUT_MS / 1000 + 's 被终止').trim(), elapsedMs: Date.now() - started, backend: 'headless' });
    }, TASK_TIMEOUT_MS);
    child.stdout.on('data', (d) => {
      stdout += d;
      onDelta?.(d.toString());
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      finish({ ok: code === 0, exitCode: code, stdout: stdout.trim(), stderr: stderr.trim(), elapsedMs: Date.now() - started, backend: 'headless' });
    });
    child.on('error', (e) => {
      finish({ ok: false, exitCode: -1, stdout: stdout.trim(), stderr: String(e), elapsedMs: Date.now() - started, backend: 'headless' });
    });
  });
}

// ---- DSH Web API RPC 封装（127.0.0.1:3080）----
async function fetchRpc(method, payload) {
  const resp = await fetch(WEB_API_BASE + '/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: cryptoRandom(), method, payload }),
  });
  if (!resp.ok) throw new Error(method + ' HTTP ' + resp.status);
  const json = await resp.json();
  if (!json.result?.ok) throw new Error(method + ' failed: ' + JSON.stringify(json.result?.error || {}).slice(0, 200));
  return json.result.value;
}

// ---- Web API 后端（复用指定会话，实现多轮对话）----
// sessionId 由调用方（注册表）给出；这里只负责 prompt + 轮询"本轮"增量。
// 提交前先记录历史进度，输出与结束判定都只针对提交之后新增的事件，
// 因此复用旧会话时不会把历史对话混入本轮结果。
async function runWebApi(task, onDelta, sessionId) {
  const started = Date.now();
  try {
    // 1. 记录提交前的历史进度（重试 3 次；仍失败视为后端不可用，交由调用方回退 headless）
    let startLen = 0;
    let preTurnEnds = 0;
    for (let i = 0; i < 3; i++) {
      try {
        const value = await fetchRpc('session.history', { sessionId });
        const events = value.events || [];
        startLen = events.length;
        preTurnEnds = events.filter((e) => e.event?.type === 'turn/end').length;
        break;
      } catch (e) {
        if (i === 2) throw e;
        await sleep(500);
      }
    }

    // 2. 提交任务（复用会话 → DSH 保留上下文）
    await fetchRpc('session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: task }],
    });

    // 3. 轮询历史直到本轮 turn/end 或超时
    const deadline = Date.now() + TASK_TIMEOUT_MS;
    let lastText = '';
    while (Date.now() < deadline) {
      await sleep(1500);
      let events = [];
      try {
        const value = await fetchRpc('session.history', { sessionId });
        events = value.events || [];
      } catch {
        continue; // 单次轮询失败先跳过，等下一轮
      }
      // 只取提交之后新增的事件，避免带上历史对话
      const newEvents = events.length > startLen ? events.slice(startLen) : [];
      const assistantText = newEvents
        .filter((e) => e.event?.type === 'assistant/message')
        .flatMap((e) => e.event.data?.message?.content || [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
      if (assistantText && assistantText !== lastText) {
        const delta = assistantText.length > lastText.length ? assistantText.slice(lastText.length) : assistantText;
        lastText = assistantText;
        onDelta?.(delta + '\n');
      }
      // 本轮结束判定：新增事件里出现 turn/end，或总 turn/end 数超过提交前
      const newTurnEnds = newEvents.filter((e) => e.event?.type === 'turn/end').length;
      const totalTurnEnds = events.filter((e) => e.event?.type === 'turn/end').length;
      if (newTurnEnds > 0 || totalTurnEnds > preTurnEnds) {
        return { ok: true, exitCode: 0, stdout: lastText, stderr: '', elapsedMs: Date.now() - started, backend: 'webapi', sessionId };
      }
    }
    return { ok: false, exitCode: -1, stdout: lastText, stderr: '[超时] Web API 后端等待结果超时', elapsedMs: Date.now() - started, backend: 'webapi', sessionId };
  } catch (e) {
    return { ok: false, exitCode: -1, stdout: '', stderr: 'Web API 后端不可用: ' + String(e), elapsedMs: Date.now() - started, backend: 'webapi', sessionId };
  }
}

function cryptoRandom() {
  return 'rpc-' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---- DSH 审批转发：常驻 SSE 监听 approval/requested，回传结果到 /api/respond ----
// SSE 帧（/api/events.mux 推送，data: <json>\n\n）：
//   {"type":"server-request","rpcId":"<uuid>","method":"approval/requested",
//    "payload":{"type":"approval/requested","sessionId":"...","approvalId":"...",
//               "toolName":"...","callId":"...","reason":"..."}}
// 回传（POST /api/respond）：
//   {"type":"client-response","rpcId":"<帧里的 rpcId>",
//    "result":{"ok":true,"value":{"sessionId":"...","approvalId":"...","outcome":"allowed-once"|"rejected"}}}
// 解析单个 SSE 事件块（\n\n 分隔）→ 取 data: 行 JSON；注释/心跳（":" 开头）与非 JSON 忽略。
function parseSseBlock(block) {
  if (!block || block.startsWith(':')) return undefined;
  const dataLines = [];
  let eventName;
  for (const line of block.split('\n')) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    else if (line.startsWith('event:')) eventName = line.slice(6).trim();
  }
  if (dataLines.length === 0) return undefined;
  try {
    return { event: eventName, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return undefined;
  }
}

// 常驻 SSE 审批中继：连接失败静默指数退避重试（1s→30s 封顶），不影响其他功能。
// 断线重连后 pending 表保留（approvalId 仍有效，DSH 端审批未过期）。
export function createApprovalRelay({ baseUrl = 'http://127.0.0.1:3080' } = {}) {
  const pending = new Map(); // approvalId -> {rpcId, sessionId, approvalId, toolName, callId, reason, receivedAt}
  const MAX_PENDING = 50; // 上限 50 条，先进先出淘汰
  let state = 'stopped';
  let generation = 0; // 连接代次：stop()/重启后使旧连接的重连计划失效
  let retryMs = 1000; // 指数退避起点
  let retryTimer = null;
  let abortController = null;
  let activeWs = null; // 当前 WebSocket 连接（供 stop() 关闭）

  function evictOldest() {
    while (pending.size > MAX_PENDING) {
      const oldest = pending.keys().next().value;
      if (oldest === undefined) break;
      pending.delete(oldest);
    }
  }

  function ingest(frame) {
    if (!frame || typeof frame !== 'object') return;
    const p = frame.payload;
    const isApproval = frame.method === 'approval/requested' || (p && p.type === 'approval/requested');
    if (!isApproval) return;
    if (!p || typeof p !== 'object') return;
    const approvalId = String(p.approvalId || frame.rpcId || '');
    if (!approvalId) return;
    // 同 approvalId 重复到达 → set 覆盖并移到 Map 尾部（最新）
    pending.set(approvalId, {
      rpcId: frame.rpcId,
      sessionId: p.sessionId,
      approvalId,
      toolName: p.toolName,
      callId: p.callId,
      reason: p.reason,
      receivedAt: new Date().toISOString(),
    });
    evictOldest();
  }

  // 待审批列表，最新在前（Map 插入序 = 接收序，反转即最新在前）
  function listPending() {
    return [...pending.values()].reverse();
  }

  // 回传审批结果：用存储的 rpcId 调 /api/respond，成功才从表移除
  async function respond({ approvalId, outcome } = {}) {
    const rec = pending.get(approvalId);
    if (!rec) return { ok: false, error: '未知 approvalId（可能已处理或已过期）' };
    if (outcome !== 'allowed-once' && outcome !== 'rejected') {
      return { ok: false, error: 'outcome 只允许 allowed-once / rejected' };
    }
    let resp;
    try {
      resp = await fetch(baseUrl + '/api/respond', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-response',
          rpcId: rec.rpcId,
          result: {
            ok: true,
            value: { sessionId: rec.sessionId, approvalId: rec.approvalId, outcome },
          },
        }),
      });
    } catch (e) {
      return { ok: false, error: 'respond 请求失败: ' + String(e) };
    }
    if (!resp.ok) return { ok: false, error: 'respond HTTP ' + resp.status };
    let json = null;
    try { json = await resp.json(); } catch { /* 非 JSON 响应也视为已接受 */ }
    if (json && (json.ok === false || json.result?.ok === false)) {
      return { ok: false, error: JSON.stringify(json.error || json.result?.error || 'respond 被拒绝').slice(0, 300) };
    }
    pending.delete(approvalId);
    return { ok: true };
  }

  function scheduleReconnect(gen) {
    if (state !== 'running' || gen !== generation) return;
    retryTimer = setTimeout(() => { connect(gen).catch(() => {}); }, retryMs);
    retryMs = Math.min(retryMs * 2, 30000); // 1s → 30s 封顶
  }

  async function connect(gen) {
    if (state !== 'running' || gen !== generation) return;
    try {
      // DSH 事件流是 WebSocket（/api/events.mux），不是 SSE（fetch 会 426）
      // Node 22+ 全局 WebSocket，本机端口无需鉴权
      const wsUrl = baseUrl.replace(/^http/, 'ws') + '/api/events.mux';
      const ws = new WebSocket(wsUrl);
      const stopWatchdog = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) { try { ws.close(); } catch { /* ignore */ } }
      }, 10000); // 10s 连接看门狗

      ws.onopen = () => {
        clearTimeout(stopWatchdog);
        retryMs = 1000; // 连接成功即重置退避
      };
      ws.onmessage = (e) => {
        try {
          const frame = JSON.parse(String(e.data));
          ingest(frame);
        } catch { /* 坏帧忽略 */ }
      };
      ws.onclose = () => {
        clearTimeout(stopWatchdog);
        scheduleReconnect(gen);
      };
      ws.onerror = () => {
        clearTimeout(stopWatchdog);
        try { ws.close(); } catch { /* ignore */ }
        scheduleReconnect(gen);
      };
      // 记住当前 ws，供 stop() 关闭
      activeWs = ws;
      ws.addEventListener('close', () => { if (activeWs === ws) activeWs = null; });
    } catch {
      scheduleReconnect(gen);
    }
  }

  function start() {
    if (state === 'running') return;
    state = 'running';
    generation += 1;
    retryMs = 1000;
    connect(generation).catch(() => {});
  }

  function stop() {
    state = 'stopped';
    generation += 1; // 使旧连接/重连计划失效
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (activeWs) { try { activeWs.close(); } catch { /* ignore */ } activeWs = null; }
  }

  start(); // 创建即启动常驻连接（失败静默重试，不影响其他功能）

  return { listPending, respond, start, stop };
}

// ---- 执行器入口：mode=both 时优先 Web API（复用会话），失败回退 headless ----
export function createExecutor({ mode = 'lan', sessionsDir = ROOT_DIR } = {}) {
  // ---- 会话注册表：内存 Map + sessions.json 持久化（重启可恢复）----
  const registry = new Map();
  const SESSIONS_PATH = path.join(sessionsDir, 'sessions.json');

  function loadRegistry() {
    try {
      if (!existsSync(SESSIONS_PATH)) return;
      const arr = JSON.parse(readFileSync(SESSIONS_PATH, 'utf8'));
      if (!Array.isArray(arr)) return;
      for (const s of arr) {
        if (s && s.sessionId && s.backend === 'webapi') {
          registry.set(s.sessionId, {
            sessionId: s.sessionId,
            backend: 'webapi',
            createdAt: s.createdAt || new Date().toISOString(),
            lastUsedAt: s.lastUsedAt || new Date().toISOString(),
          });
        }
      }
    } catch {
      // 文件损坏等异常 → 从空注册表开始
    }
  }
  function saveRegistry() {
    try {
      writeFileSync(SESSIONS_PATH, JSON.stringify([...registry.values()], null, 2));
    } catch {
      // 持久化失败不阻塞执行（内存注册表仍可用）
    }
  }
  function register(sessionId) {
    const now = new Date().toISOString();
    const s = { sessionId, backend: 'webapi', createdAt: now, lastUsedAt: now };
    registry.set(sessionId, s);
    if (registry.size > MAX_REGISTERED_SESSIONS) {
      const oldest = [...registry.values()].sort((a, b) => String(a.lastUsedAt || '').localeCompare(String(b.lastUsedAt || '')))[0];
      if (oldest) registry.delete(oldest.sessionId);
    }
    saveRegistry();
    return s;
  }
  function touch(sessionId) {
    const s = registry.get(sessionId);
    if (!s) return;
    s.lastUsedAt = new Date().toISOString();
    saveRegistry();
  }

  // 强制新建一个 Web API 会话并注册（POST /api/sessions 用）
  async function createSession() {
    const value = await fetchRpc('session.create', { cwd: ROOT_DIR, agentPreset: 'standard' });
    if (!value?.sessionId) throw new Error('session.create 未返回 sessionId');
    return register(value.sessionId);
  }

  // 返回现有 webapi 会话（最近使用优先）；无则新建（run 默认路径用）
  async function ensureSession() {
    if (registry.size === 0) return createSession();
    const sorted = [...registry.values()].sort((a, b) => String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')));
    return sorted[0];
  }

  loadRegistry();

  const executor = {
    mode,
    // 注册表快照（按最近使用排序），供 GET /api/sessions 使用
    listSessions() {
      return [...registry.values()]
        .sort((a, b) => String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')))
        .map((s) => ({ ...s }));
    },
    ensureSession,
    createSession,
    // 兼容旧调用 run(task, onDelta)；新调用 run(task, { sessionId }, onDelta)
    async run(task, optsOrOnDelta, onDelta) {
      let opts = {};
      if (typeof optsOrOnDelta === 'function') {
        onDelta = optsOrOnDelta;
      } else if (optsOrOnDelta && typeof optsOrOnDelta === 'object') {
        opts = optsOrOnDelta;
      }

      // lan 模式：行为完全不变，一律 headless（忽略 sessionId）
      if (mode !== 'both') return runHeadless(task, onDelta);

      let sessionId = opts.sessionId;
      if (sessionId && !registry.has(sessionId)) sessionId = undefined; // 指定会话不存在 → 走默认逻辑

      // 指定会话：直接复用（保留上下文）
      if (sessionId) {
        const webResult = await runWebApi(task, onDelta, sessionId);
        touch(sessionId);
        if (webResult.ok || !webResult.stderr.includes('不可用')) return webResult;
        return runHeadless(task, onDelta); // Web API 失败 → 回退 headless
      }

      // 默认：复用现有会话（会话连续性）或新建；Web API 不可用则回退 headless
      let sess;
      try {
        sess = await ensureSession();
      } catch {
        return runHeadless(task, onDelta);
      }
      const webResult = await runWebApi(task, onDelta, sess.sessionId);
      touch(sess.sessionId);
      if (webResult.ok || !webResult.stderr.includes('不可用')) return webResult;
      return runHeadless(task, onDelta);
    },
  };

  // 审批转发中继：懒创建单例（首次访问 executor.relay 才建立常驻 SSE 连接）。
  // transport 在装配时访问一次 executor.relay，即实现"服务启动即监听审批"；
  // 不访问则不产生任何连接/定时器（lan 模式或测试场景零副作用）。
  let relayInstance = null;
  Object.defineProperty(executor, 'relay', {
    enumerable: true,
    get() {
      if (!relayInstance) relayInstance = createApprovalRelay();
      return relayInstance;
    },
  });
  return executor;
}
