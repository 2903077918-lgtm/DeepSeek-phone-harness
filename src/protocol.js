// src/protocol.js —— 云端通信协议信封 + 消息类型常量（Agent 与云端共享一份）
// 对应 docs/architecture/cloud-architecture.md 第 2 章。
// 本模块为纯函数 + 常量，无状态、零依赖，供 Agent 侧 cloud 通道 / 未来云端复用。
// 用途切分：
//   createEnvelope / parseEnvelope —— 通用 WS 消息信封（v/type/msgId/seq/ts/deviceId/payload）
//   MSG_TYPES —— 消息方向与用途清单
//   validateEnvelope —— 信封结构校验（丢弃坏帧）

export const PROTOCOL_VERSION = 1;

// 消息类型清单（见架构文档 2.5）
export const MSG_TYPES = {
  // 心跳
  PING: 'control.ping',
  PONG: 'control.pong',
  // 连接生命周期
  HELLO: 'agent.hello',
  BYE: 'agent.bye',
  STATE: 'agent.state',
  BIND_CONFIRMED: 'bind.confirmed',
  BIND_REVOKED: 'bind.revoked',
  // 任务
  TASK_SUBMIT: 'task.submit',
  TASK_CANCEL: 'task.cancel',
  TASK_STATUS: 'task.status',
  TASK_RESULT: 'task.result',
  TASK_ACK: 'task.ack',
  // 确认 / 紧急
  CONFIRM_REQUEST: 'confirm.request',
  CONFIRM_RESPONSE: 'confirm.response',
  KILL: 'control.kill',
  ERROR: 'error',
};

// 单台设备内部自增 seq 计数器（雪花式单调递增，Agent/云端各自维护）
export function createSeq() {
  let n = 0;
  return {
    next: () => ++n,
    current: () => n,
  };
}

/**
 * 构造一条协议信封。
 * @param {string} type    消息类型（MSG_TYPES.*）
 * @param {object} opts    可选：{deviceId, seq, ts, msgId}
 * @param {object} payload 业务字段
 */
export function createEnvelope(type, opts = {}, payload = {}) {
  const env = {
    v: PROTOCOL_VERSION,
    type,
    msgId: opts.msgId || randomUUID(),
    seq: Number.isInteger(opts.seq) ? opts.seq : 0,
    ts: opts.ts || new Date().toISOString(),
  };
  if (opts.deviceId) env.deviceId = opts.deviceId;
  if (payload && typeof payload === 'object' && Object.keys(payload).length) env.payload = payload;
  return env;
}

// 解析一根 WS 消息：非法 JSON → null（调用方丢弃坏帧）
export function parseEnvelope(data) {
  if (typeof data === 'string' && data.trim() === '') return null;
  try {
    return JSON.parse(String(data));
  } catch {
    return null;
  }
}

// 信封结构校验：返回 true 表示结构合法（v/type/msgId 存在）；不校验 payload 深度。
export function validateEnvelope(env) {
  if (!env || typeof env !== 'object') return false;
  if (env.v !== PROTOCOL_VERSION) return false;
  if (typeof env.type !== 'string' || !env.type) return false;
  if (typeof env.msgId !== 'string' || !env.msgId) return false;
  return true;
}

// 兼容浏览器与 Node 的 UUID 生成（Node 22+ crypto.randomUUID 是全局的）
function randomUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
