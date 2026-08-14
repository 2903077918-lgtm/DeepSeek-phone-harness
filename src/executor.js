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

// ---- DSH 只读同步 / 历史归一化（探测结论）----
// workspace.list → value.items[{workspaceId, path, title, sessionIds, ...}]
// session.list   → value.items[{sessionId, updatedAt(epoch ms), running, blank, cwd,
//                               projections.values.title, ...}]（title 零额外 RPC 可得）
// session.history→ value.events[{event:{type, seq, time(epoch ms), data}}]（limit/afterSeq 参数被忽略，返回全量）
// events.mux WS 帧: {"type":"server-request","rpcId","method","payload"}
//   method='session/event'     → payload:{type:'session/event', sessionId, event}（event 结构与 history 一致）
//   method='session/subscribed'→ payload:{type:'session/subscribed', sessionId, lastSeq}（连接时水位）
//   增量文本: assistant/chunk 的 data.chunk.{type:'text-delta'|'reasoning-delta', text}
function isoTime(t) {
  const n = Number(t);
  return new Date(Number.isFinite(n) && n > 0 ? n : Date.now()).toISOString();
}

// 会话事件 → 流式条目（/api/events 增量用）
// 提取规则：assistant/chunk 增量文本（text-delta / reasoning-delta / tool-call-delta / block-start）；
//   assistant/message 与 user/message 的 content[].text；tool/call 的 name；
//   其余事件保留 type 但无 text（前端可据此感知 turn/end 等状态）。
function eventToStreamItem(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const type = ev.type;
  const data = ev.data || {};
  let text;
  let subtype = null;
  let kind = 'other'; // 标准化类型：text(可见文本) | thinking(推理) | tool(工具) | done(完成) | other
  if (type === 'assistant/chunk') {
    const chunk = data.chunk;
    if (chunk && typeof chunk === 'object') {
      // DSH chunk 变体：text-delta（可见增量）/ reasoning-delta（推理）/ tool-call-delta / block-start / block-end
      const ctype = chunk.type;
      if (ctype === 'text-delta' && typeof chunk.text === 'string') {
        text = chunk.text; subtype = 'text'; kind = 'text';
      } else if (ctype === 'reasoning-delta' && typeof chunk.text === 'string') {
        text = chunk.text; subtype = 'reasoning'; kind = 'thinking';
      } else if (ctype === 'tool-call-delta' && typeof chunk.name === 'string') {
        text = chunk.name; subtype = 'tool'; kind = 'tool';
      } else if (ctype === 'block-start') {
        subtype = 'block-start'; text = ''; kind = 'other';
      }
    }
  } else if (type === 'assistant/message' || type === 'user/message') {
    const content = type === 'assistant/message' ? (data.message && data.message.content) : data.content;
    if (Array.isArray(content)) {
      const t = content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('');
      if (t) { text = t; kind = 'text'; }
    }
  } else if (type === 'tool/call') {
    if (data.name) { text = String(data.name); kind = 'tool'; }
  } else if (type === 'turn/end') {
    kind = 'done';
  }
  const item = { seq: Number(ev.seq) || 0, type, kind, time: isoTime(ev.time) };
  if (text !== undefined) item.text = text;
  if (subtype) item.subtype = subtype;
  return item;
}

// session.history events → 对话消息数组（/api/dsh-history 用）
function historyToMessages(events) {
  const items = [];
  for (const ev of events || []) {
    const e = ev && ev.event;
    if (!e) continue;
    const data = e.data || {};
    if (e.type === 'user/message' && Array.isArray(data.content)) {
      const text = data.content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('');
      if (text) items.push({ role: 'user', text, time: isoTime(e.time) });
    } else if (e.type === 'assistant/message') {
      const content = data.message && data.message.content;
      if (Array.isArray(content)) {
        const text = content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('');
        if (text) items.push({ role: 'assistant', text, time: isoTime(e.time) });
      }
    } else if (e.type === 'tool/call' && data.name) {
      items.push({ role: 'tool', text: String(data.name), time: isoTime(e.time) });
    }
  }
  return items;
}

// 归一化路径（Windows 反斜杠 → 正斜杠小写），供 cwd 前缀分组
function normPath(p) {
  return String(p || '').replace(/\\/g, '/').toLowerCase();
}

// ---- DSH 审批转发：常驻 WebSocket 监听 approval/requested，回传结果到 /api/respond ----
// 事件流（探测结论）：/api/events.mux 是 WebSocket 而非 SSE —— 普通 fetch 返回 426 upgrade required。
//   用 Node 22+ 全局 WebSocket（零依赖、无需鉴权头）连 ws://127.0.0.1:3080/api/events.mux，
//   收到 JSON 文本帧：{"type":"server-request","rpcId":"<uuid>","method":"approval/requested",
//                     "payload":{"type":"approval/requested","sessionId":"...","approvalId":"...",
//                                "toolName":"...","callId":"...","reason":"..."}}
//   rpcId 在帧外层（envelope.rpcId），approvalId 在 payload.approvalId，method 为事件类型。
// 回传（HTTP POST /api/respond）：
//   {"type":"client-response","rpcId":"<帧外层 rpcId>",
//    "result":{"ok":true,"value":{"sessionId":"...","approvalId":"...","outcome":"allowed-once"|"rejected"}}}
// 常驻审批中继：连接失败静默指数退避重试（1s→30s 封顶），不影响其他功能；
// 断线重连后 pending 表保留（approvalId 仍有效，DSH 端审批未过期）。
export function createApprovalRelay({ baseUrl = 'http://127.0.0.1:3080' } = {}) {
  const pending = new Map(); // approvalId -> {rpcId, sessionId, approvalId, toolName, callId, reason, receivedAt}
  const MAX_PENDING = 50; // 上限 50 条，先进先出淘汰
  let state = 'stopped';
  let generation = 0; // 连接代次：stop()/重启后使旧连接的重连计划失效
  let retryMs = 1000; // 指数退避起点
  let retryTimer = null;
  let activeWs = null; // 当前 WebSocket 连接（供 stop() 关闭）

  // ---- 会话事件流缓冲（流式输出轮询源）----
  // events.mux 除了 approval/requested，还推送 session/event（含 assistant/chunk 增量文本）
  // 与 session/subscribed（连接时各会话 lastSeq 水位）。每个会话最近的事件缓存为 seq 升序数组，
  // getEvents(sessionId, afterSeq) 返回 seq > afterSeq 的增量；缓冲为空或落后于请求水位时
  // 懒回填 session.history（5s 冷却，避免反复拉取大历史；history 无 limit 参数会返回全量）。
  const eventsBySession = new Map(); // sessionId -> [{seq,type,text?,subtype?,time}]（按 seq 升序）
  const subscribedSeq = new Map();   // sessionId -> 连接时 lastSeq 水位（判断是否需要回填）
  const lastHistoryFetch = new Map();// sessionId -> 上次 history 回填时间（冷却用）
  const MAX_EVENTS_PER_SESSION = 200; // 每会话保留最近 200 条
  const MAX_EVENT_SESSIONS = 200;     // 缓冲的会话数上限（LRU 淘汰）
  const HISTORY_FETCH_COOLDOWN_MS = 5000;

  function pushEvent(sessionId, item) {
    let arr = eventsBySession.get(sessionId);
    if (!arr) {
      if (eventsBySession.size >= MAX_EVENT_SESSIONS) {
        const oldestKey = eventsBySession.keys().next().value; // Map 插入序最旧
        if (oldestKey !== undefined) eventsBySession.delete(oldestKey);
      }
      arr = [];
      eventsBySession.set(sessionId, arr);
    } else {
      eventsBySession.delete(sessionId); // 移到尾部（LRU：最近更新的会话最后淘汰）
      eventsBySession.set(sessionId, arr);
    }
    const last = arr.length ? arr[arr.length - 1].seq : -1;
    if (item.seq <= last) return; // 按 seq 去重（WS 实时帧与 history 回填可能重复）
    arr.push(item);
    if (arr.length > MAX_EVENTS_PER_SESSION) arr.splice(0, arr.length - MAX_EVENTS_PER_SESSION);
  }

  // 轮询增量：返回该会话 seq > afterSeq 的新事件 + 当前水位 lastSeq
  // 缓冲缺失/落后时懒回填 session.history；会话不存在或 DSH 不可用静默返回空。
  async function getEvents(sessionId, afterSeq = 0) {
    const sid = String(sessionId || '').trim();
    const after = Number(afterSeq) || 0;
    if (!sid) return { items: [], lastSeq: after };
    let arr = eventsBySession.get(sid) || [];
    const last = arr.length ? arr[arr.length - 1].seq : -1;
    const needFetch = arr.length === 0 || after > last;
    const watermark = subscribedSeq.get(sid);
    const nothingNew = watermark !== undefined && after >= watermark; // 水位确认没有更新事件
    if (needFetch && !nothingNew && Date.now() - (lastHistoryFetch.get(sid) || 0) >= HISTORY_FETCH_COOLDOWN_MS) {
      lastHistoryFetch.set(sid, Date.now());
      try {
        const value = await fetchRpc('session.history', { sessionId: sid });
        const items = (value.events || [])
          .map((ev) => eventToStreamItem(ev && ev.event))
          .filter((i) => i && i.seq > after)
          .slice(-MAX_EVENTS_PER_SESSION);
        for (const it of items) pushEvent(sid, it);
        arr = eventsBySession.get(sid) || [];
      } catch { /* 会话不存在 / DSH 不可用 → 保持现状 */ }
    }
    return { items: arr.filter((i) => i.seq > after), lastSeq: arr.length ? arr[arr.length - 1].seq : after };
  }

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
    // 会话事件帧：缓存增量文本，供 /api/events 轮询
    if (frame.method === 'session/event' && p && p.sessionId && p.event) {
      const item = eventToStreamItem(p.event);
      if (item) pushEvent(String(p.sessionId), item);
      return;
    }
    // 连接时各会话水位：getEvents 判断是否需要回填 history
    if (frame.method === 'session/subscribed' && p && p.sessionId) {
      subscribedSeq.set(String(p.sessionId), Number(p.lastSeq) || 0);
      return;
    }
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
    if (retryTimer) return; // onerror+onclose 双触发只排一次重连，退避只推进一次
    retryTimer = setTimeout(() => { retryTimer = null; connect(gen).catch(() => {}); }, retryMs);
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
        if (state !== 'running' || gen !== generation) return; // stop()/换代后忽略迟到帧
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
    if (activeWs) {
      const s = activeWs; activeWs = null;
      try { s.onopen = s.onmessage = s.onerror = s.onclose = null; s.close(); } catch { /* ignore */ }
    }
  }

  start(); // 创建即启动常驻连接（失败静默重试，不影响其他功能）

  return { listPending, respond, getEvents, start, stop };
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
    // ---- DSH 只读同步 API（转发并归一化，供手机端浏览电脑上的项目/会话）----
    // GET /api/dsh-workspaces：workspace.list + 按 cwd 前缀重新分组
    // （workspace.sessionIds 可能不准——实测多数为空——故以 session.list 的 cwd 前缀为准，
    //  与声明的 sessionIds 取并集计数；长路径优先匹配，避免嵌套工作区归属错误）
    async listDshWorkspaces() {
      const [wsValue, slValue] = await Promise.all([
        fetchRpc('workspace.list', {}),
        fetchRpc('session.list', {}),
      ]);
      const workspaces = (wsValue && wsValue.items) || [];
      const sessions = (slValue && slValue.items) || [];
      const matched = new Map(); // workspaceId -> Set<sessionId>
      for (const w of workspaces) matched.set(w.workspaceId, new Set((w.sessionIds || []).filter(Boolean)));
      const sorted = [...workspaces].sort((a, b) => normPath(b.path).length - normPath(a.path).length);
      for (const s of sessions) {
        const cwd = normPath(s.cwd);
        if (!cwd) continue;
        const ws = sorted.find((w) => {
          const p = normPath(w.path);
          return cwd === p || cwd.startsWith(p + '/');
        });
        if (ws) { const set = matched.get(ws.workspaceId); if (set) set.add(s.sessionId); }
      }
      return workspaces.map((w) => ({
        workspaceId: w.workspaceId,
        path: w.path,
        title: w.title || null,
        sessionCount: (matched.get(w.workspaceId) || new Set()).size,
      }));
    },
    // GET /api/dsh-sessions：session.list 归一化（title 取自 projections，零额外 RPC）
    async listDshSessions() {
      const value = await fetchRpc('session.list', {});
      return ((value && value.items) || []).map((s) => ({
        sessionId: s.sessionId,
        cwd: s.cwd,
        title: (s.projections && s.projections.values && s.projections.values.title) || undefined,
        updatedAt: isoTime(s.updatedAt),
        running: !!s.running,
        blank: !!s.blank,
      }));
    },
    // POST /api/dsh-continue：对 DSH 已有会话继续发消息（不新建、不改注册表）。
    // 复用 runWebApi 的"记录提交前进度 + 只统计本轮增量"逻辑；存在性用一次轻量 session.list 检查。
    async continueSession({ sessionId, task, onDelta } = {}) {
      const sid = String(sessionId || '').trim();
      if (!sid) return { ok: false, code: 'bad-request', error: 'sessionId 不能为空' };
      let known = false;
      try {
        const value = await fetchRpc('session.list', {});
        known = ((value && value.items) || []).some((s) => s.sessionId === sid);
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: 'Web API 后端不可用: ' + String(e) };
      }
      if (!known) return { ok: false, code: 'session-not-found', error: '会话不存在: ' + sid };
      const result = await runWebApi(task, onDelta, sid);
      return { ok: true, sessionId: sid, result };
    },
    // GET /api/dsh-history?sessionId=：转发 session.history 归一化为对话消息
    async getDshHistory(sessionId, limit) {
      const sid = String(sessionId || '').trim();
      if (!sid) throw new Error('sessionId 不能为空');
      const value = await fetchRpc('session.history', { sessionId: sid });
      let items = historyToMessages((value && value.events) || []);
      const n = Number(limit);
      if (Number.isInteger(n) && n > 0 && items.length > n) items = items.slice(-n);
      return items;
    },
    // GET /api/events?sessionId=&afterSeq=：流式增量轮询（缓冲来自 events.mux 的 session/event 帧）
    getEvents(sessionId, afterSeq) {
      return this.relay.getEvents(sessionId, afterSeq);
    },
  };

  // 审批转发中继：懒创建单例（首次访问 executor.relay 才建立常驻 WebSocket 连接）。
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
