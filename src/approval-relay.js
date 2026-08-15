// src/approval-relay.js —— DSH 审批转发中继 + 会话事件流缓冲
// 从 executor.js 拆分而来，独立成模块：常驻 WebSocket 监听 DSH /api/events.mux，
//   - approval/requested → pending 表（经 /api/approvals 回传 /api/respond）
//   - session/event → 每会话最近 200 条缓冲（供 /api/events 流式增量轮询）
//   - session/subscribed → 连接时各会话 lastSeq 水位（判断是否需要回填 history）
// 零第三方依赖：Node 22+ 全局 WebSocket；失败静默指数退避重连（1s→30s 封顶）。
import { fetchRpc, eventToStreamItem, isoTime } from './dsh-utils.js';

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
    // 已解决帧：清除 pending（approval/resolved 与 question/resolved）
    if (frame.method === 'approval/resolved' || (p && p.type === 'approval/resolved')) {
      const aid = String((p && p.approvalId) || '');
      if (aid) pending.delete(aid);
      return;
    }
    if (frame.method === 'question/resolved' || (p && p.type === 'question/resolved')) {
      const qrpc = String((p && p.questionRpcId) || '');
      if (qrpc) pending.delete('q:' + qrpc);
      return;
    }
    // 用户提问帧：question/requested（ask_user_question 工具）→ 与审批同表，kind='question'
    // 帧形：{method:'question/requested', rpcId, payload:{type, sessionId, questions:[...]}}
    const isQuestion = frame.method === 'question/requested' || (p && p.type === 'question/requested');
    if (isQuestion) {
      if (!p || typeof p !== 'object') return;
      const rpcId = String(frame.rpcId || p.rpcId || '');
      if (!rpcId) return;
      pending.set('q:' + rpcId, {
        kind: 'question',
        rpcId,
        questionKey: 'q:' + rpcId,
        sessionId: String(p.sessionId || ''),
        questions: Array.isArray(p.questions) ? p.questions : [],
        receivedAt: new Date().toISOString(),
      });
      evictOldest();
      return;
    }
    const isApproval = frame.method === 'approval/requested' || (p && p.type === 'approval/requested');
    if (!isApproval) return;
    if (!p || typeof p !== 'object') return;
    const approvalId = String(p.approvalId || frame.rpcId || '');
    if (!approvalId) return;
    // 同 approvalId 重复到达 → set 覆盖并移到 Map 尾部（最新）
    pending.set(approvalId, {
      kind: 'approval',
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

  // 待审批/待回答列表，最新在前（Map 插入序 = 接收序，反转即最新在前）
  function listPending() {
    return [...pending.values()].reverse();
  }

  // 回传结果：审批用 {approvalId, outcome}，提问用 {questionKey, answer}。
  // 用存储的 rpcId 调 /api/respond，成功才从表移除。
  async function respond({ approvalId, outcome, questionKey, answer } = {}) {
    const rec = questionKey ? pending.get(questionKey)
      : approvalId ? pending.get(approvalId)
      : undefined;
    if (!rec) return { ok: false, error: '未知请求（可能已处理或已过期）' };
    let value;
    if (rec.kind === 'question') {
      // 回答协议（与 Web GUI 一致）：value={sessionId, answer:{answers:[{id,selected[],custom?}]}}
      if (!answer || !Array.isArray(answer.answers) || answer.answers.length === 0) {
        return { ok: false, error: 'answer 必须为 {answers:[{id,selected,...}]} 数组' };
      }
      value = { sessionId: rec.sessionId, answer };
    } else {
      if (outcome !== 'allowed-once' && outcome !== 'rejected') {
        return { ok: false, error: 'outcome 只允许 allowed-once / rejected' };
      }
      value = { sessionId: rec.sessionId, approvalId: rec.approvalId, outcome };
    }
    let resp;
    try {
      resp = await fetch(baseUrl + '/api/respond', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-response',
          rpcId: rec.rpcId,
          result: { ok: true, value },
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
    pending.delete(questionKey || approvalId);
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
