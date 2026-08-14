// src/transport/cloud.mjs —— Agent 云端传输层（WSS 出站客户端）
// 对应 docs/architecture/cloud-architecture.md 第 2.3/2.4/2.6、第 5.2 节。
// 设计要点：
//   - Agent 永远**出站**连云端（NAT/家庭宽带无需入站端口），默认用 Node 全局 WebSocket（零依赖，
//     与 approval-relay.js 相同方式连 DSH events.mux）。
//   - 连接生命周期：connect → 发送 agent.hello（带 deviceToken + resumeToken + pendingTasks）→ 心跳
//     → 断线按指数退避重连（1s→60s + ±20% 抖动），重连重发 hello 并可回放 outbox。
//   - 心跳：每 heartbeatMs 发 control.ping，连续 miss 上限次未收 control.pong 判定断线。
//   - 可靠投递（至少一次）：sendStatus/sendResult/sendRaw 自动带 msgId+seq 入 outbox，收到 task.ack
//     才出队；断线期间任务在本地继续执行，重连后补报。
//   - 依赖注入 socketFactory/now/setTimer 便于本地 mock 单测协议状态机，无需真实云端。
//   - E2EE/风险分级由更高层（阶段3 完整接线）复用 src/e2ee.js、src/guard.js；本层只负责传输信封。

import { createEnvelope, parseEnvelope, validateEnvelope, MSG_TYPES, createSeq } from '../protocol.js';

export const HEARTBEAT_INTERVAL_MS = 25000;   // Agent 每 25s 发 ping
export const HEARTBEAT_MISS_LIMIT = 3;        // 连续 3 次无 pong 判定断线
export const RECONNECT_BASE_MS = 1000;        // 指数退避起点
export const RECONNECT_MAX_MS = 60000;        // 退避封顶
export const RECONNECT_JITTER = 0.2;          // ±20% 随机抖动

// 默认 socket 工厂：Node 全局 WebSocket。
function defaultSocketFactory(url) {
  return new WebSocket(url);
}

/**
 * 创建云端传输客户端（不自动连接；调用 connect() 启动）。
 * @param {object} opts
 * @param {string} opts.url           云端 agent WS 地址（wss://…/v1/agent/ws）
 * @param {string} opts.deviceId      本设备稳定 ID
 * @param {string} opts.deviceToken   设备认证 token
 * @param {string} [opts.resumeToken] 断线恢复凭证（一次有效，重连时刷新）
 * @param {string} [opts.version]
 * @param {string[]} [opts.capabilities]
 * @param {string[]} [opts.pendingTasks] 断线期间仍在执行的任务（重连 hello 上报）
 * @param {object} [opts.socketFactory]   (url) => WebSocket-like（默认全局 WebSocket）
 * @param {number} [opts.heartbeatMs]
 * @param {number} [opts.reconnectBaseMs]
 * @param {number} [opts.reconnectMaxMs]
 * @param {(fn)=>void} [opts.setTimer]   覆盖定时器宿主（默认 setTimeout，便于测试）
 * @param {()=>Date} [opts.now]
 */
export function createCloudTransport(opts = {}) {
  const {
    url,
    deviceId,
    deviceToken,
    resumeToken = null,
    version = '0.3.0',
    capabilities = ['headless', 'web', 'confirm', 'e2ee-v1'],
    pendingTasks = [],
    socketFactory = defaultSocketFactory,
    heartbeatMs = HEARTBEAT_INTERVAL_MS,
    reconnectBaseMs = RECONNECT_BASE_MS,
    reconnectMaxMs = RECONNECT_MAX_MS,
    setTimer = setTimeout,
    now = () => new Date(),
  } = opts;

  if (!url || !deviceId || !deviceToken) {
    throw new Error('createCloudTransport: url/deviceId/deviceToken 必填');
  }

  const seqState = createSeq();
  const listeners = { connect: [], disconnect: [], message: [] };
  const outbox = new Map(); // msgId -> envelope（未 ack，重连后上层回放）

  let connState = 'idle'; // idle|connecting|open|reconnecting|closed
  let generation = 0;     // 代次：disconnect() 使旧连接/定时器/回连接作整体失效
  let socket = null;
  let missCount = 0;      // 连续未 pong 次数
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0; // 退避档位（每次从 0 起，连接成功重置）

  function on(event, cb) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(cb);
    return () => {
      const i = listeners[event].indexOf(cb);
      if (i >= 0) listeners[event].splice(i, 1);
    };
  }
  function emit(event, ...args) {
    for (const cb of (listeners[event] || []).slice()) {
      try { cb(...args); } catch { /* 监听器异常不阻断主流程 */ }
    }
  }

  function invalidate(gen) {
    return connState === 'closed' || gen !== generation;
  }

  // ---- 心跳 ----
  function scheduleHeartbeat(gen) {
    if (invalidate(gen)) return;
    if (heartbeatTimer) { setTimer(() => {}); clearTimeout(heartbeatTimer); heartbeatTimer = null; }
    heartbeatTimer = setTimer(() => {
      heartbeatTimer = null;
      if (invalidate(gen) || connState !== 'open') return;
      // 连续 miss 超限 → 判定断线，主动关闭走重连
      if (missCount >= HEARTBEAT_MISS_LIMIT) {
        try { socket && socket.close(); } catch { /* ignore */ }
        return;
      }
      sendEnvelope({ type: MSG_TYPES.PING }, false);
      missCount += 1;
      scheduleHeartbeat(gen);
    }, heartbeatMs);
  }

  // ---- 重连：指数退避 + 抖动 ----
  function delayForAttempt(attempt) {
    const cap = Math.min(reconnectMaxMs, reconnectBaseMs * Math.pow(2, attempt));
    const jitter = 1 + (Math.random() * 2 - 1) * RECONNECT_JITTER;
    return Math.max(0, Math.round(cap * jitter));
  }
  function scheduleReconnect(gen) {
    if (invalidate(gen) || connState === 'reconnecting' || connState === 'connecting') return;
    connState = 'reconnecting';
    if (reconnectTimer) return;
    const ms = delayForAttempt(reconnectAttempt);
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      if (invalidate(gen)) return;
      openSocket(gen);
    }, ms);
    emit('disconnect', { reason: 'reconnecting', delay: ms, attempt: reconnectAttempt });
  }

  // ---- 底层 socket 生命周期 ----
  function openSocket(gen) {
    if (invalidate(gen)) return;
    connState = 'connecting';
    let ws;
    try {
      ws = socketFactory(url);
    } catch {
      scheduleReconnect(gen);
      return;
    }
    socket = ws;

    ws.onopen = () => {
      if (gen !== generation || connState === 'closed') { try { ws.close(); } catch { /* ignore */ } return; }
      connState = 'open';
      missCount = 0;
      reconnectAttempt = 0; // 连接成功重置退避档位
      sendEnvelope({
        type: MSG_TYPES.HELLO,
        deviceId,
        payload: {
          agentId: deviceId, deviceId, version, capabilities,
          resumeToken: resumeToken || null, pendingTasks,
        },
      }, false);
      emit('connect', { generation: gen });
      scheduleHeartbeat(gen);
    };

    ws.onmessage = (e) => {
      if (gen !== generation) return;
      const env = parseEnvelope(e && e.data);
      if (!validateEnvelope(env)) return;
      handleMessage(env, gen);
    };

    ws.onclose = () => {
      if (gen !== generation || connState === 'closed') return;
      if (connState === 'open') emit('disconnect', { reason: 'closed' });
      scheduleReconnect(gen);
    };
    ws.onerror = () => {
      if (gen !== generation || connState === 'closed') return;
      try { ws.close(); } catch { /* ignore */ }
    };
  }

  // ---- 入站处理 ----
  function handleMessage(env, gen) {
    if (invalidate(gen)) return;
    if (env.type === MSG_TYPES.PONG) {
      missCount = 0; // 收到 pong，重置未 pong 计数
    } else if (env.type === MSG_TYPES.TASK_ACK) {
      const ackMsgId = env.payload && env.payload.msgId;
      if (ackMsgId) outbox.delete(ackMsgId);
      outboxTouchOrder(ackMsgId);
    }
    emit('message', env);
  }
  function outboxTouchOrder() { /* 占位：如需 LRU 淘汰 outbox 可在此实现 */ }

  // ---- 出站：自动带 msgId+seq；track 为 true 时入 outbox 等回执 ----
  function sendEnvelope(envelope, track = true) {
    const env = createEnvelope(envelope.type, {
      deviceId: envelope.deviceId || deviceId,
      seq: seqState.next(),
      msgId: envelope.msgId,
      ts: envelope.ts,
    }, envelope.payload || {});
    if (track) outbox.set(env.msgId, env);
    if (socket && typeof socket.send === 'function') {
      try { socket.send(JSON.stringify(env)); } catch { /* 发送失败由重连机制兜底 */ }
    }
    return env;
  }

  // ---- 对外发送接口 ----
  function sendStatus(taskId, status, extra = {}) {
    return sendEnvelope({ type: MSG_TYPES.TASK_STATUS, payload: { taskId, status, ...extra } });
  }
  function sendResult(taskId, result, extra = {}) {
    return sendEnvelope({ type: MSG_TYPES.TASK_RESULT, payload: { taskId, ...result, ...extra } });
  }
  function sendAck(ackMsgId) {
    return sendEnvelope({ type: MSG_TYPES.TASK_ACK, payload: { msgId: ackMsgId } }, false);
  }
  function sendRaw(type, payload = {}, track = true) {
    return sendEnvelope({ type, payload }, track);
  }

  // ---- 连接控制 ----
  function connect() {
    if (connState === 'open' || connState === 'connecting') return; // 已在连接中
    if (connState === 'closed') reconnectAttempt = 0; // 手动重连复位退避
    generation += 1;
    openSocket(generation);
  }
  function disconnect() {
    connState = 'closed';
    generation += 1;
    if (heartbeatTimer) { clearTimeout(heartbeatTimer); heartbeatTimer = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (socket) {
      const s = socket; socket = null;
      try { s.onopen = s.onmessage = s.onerror = s.onclose = null; s.close(); } catch { /* ignore */ }
    }
  }

  return {
    on, connect, disconnect, sendStatus, sendResult, sendAck, sendRaw,
    get state() { return connState; },
    get seq() { return seqState.current(); },
    get outboxSize() { return outbox.size; },
  };
}
