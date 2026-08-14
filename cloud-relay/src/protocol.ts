// cloud-relay/src/protocol.ts —— 云端/Agent 共享协议信封与消息类型
// 与 Agent 侧 src/protocol.js 保持**逐字一致**（防漂移，架构文档 D2）。
// 任何协议变更必须同步两侧，并加对应测试。

export const PROTOCOL_VERSION = 1;

// 消息类型清单（对应 Agent src/protocol.js MSG_TYPES，确保键名一致）
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
} as const;
export type MessageType = (typeof MSG_TYPES)[keyof typeof MSG_TYPES];

/** 协议信封（与 Agent createEnvelope 输出一致） */
export interface Envelope {
  v: number;
  type: MessageType;
  msgId: string;
  seq: number;
  ts: string;
  deviceId?: string;
  payload?: Record<string, unknown>;
}

/** 单台设备/连接内部自增 seq（Agent 与云端各自维护，雪花式单调） */
export function createSeq() {
  let n = 0;
  return {
    next: () => ++n,
    current: () => n,
  };
}

/**
 * 构造一条协议信封（与 Agent createEnvelope 行为一致）。
 * @param type    消息类型
 * @param opts    可选 {deviceId, seq, ts, msgId}
 * @param payload 业务字段
 */
export function createEnvelope(
  type: MessageType,
  opts: { deviceId?: string; seq?: number; ts?: string; msgId?: string } = {},
  payload: Record<string, unknown> = {},
): Envelope {
  const env: Envelope = {
    v: PROTOCOL_VERSION,
    type,
    msgId: opts.msgId || randomUUID(),
    seq: Number.isInteger(opts.seq) ? (opts.seq as number) : 0,
    ts: opts.ts || new Date().toISOString(),
  };
  if (opts.deviceId) env.deviceId = opts.deviceId;
  if (payload && typeof payload === 'object' && Object.keys(payload).length) env.payload = payload;
  return env;
}

/** 解析一根 WS 消息：非法 JSON / 空串 → null（调用方丢弃坏帧） */
export function parseEnvelope(data: string | ArrayBuffer | null): Envelope | null {
  if (typeof data === 'string' && data.trim() === '') return null;
  try {
    return JSON.parse(String(data)) as Envelope;
  } catch {
    return null;
  }
}

/** 信封结构校验：v/type/msgId 合法即返回 true；不校验 payload 深度。 */
export function validateEnvelope(env: unknown): env is Envelope {
  if (!env || typeof env !== 'object') return false;
  const e = env as Envelope;
  if (e.v !== PROTOCOL_VERSION) return false;
  if (typeof e.type !== 'string' || !e.type) return false;
  if (typeof e.msgId !== 'string' || !e.msgId) return false;
  // seq 必须非负整数
  if (!Number.isInteger(e.seq) || e.seq < 0) return false;
  return true;
}

// 兼容浏览器与 Cloudflare Workers 运行时（crypto 全局可用）的 UUID 生成
function randomUUID(): string {
  const c = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (c.crypto && typeof c.crypto.randomUUID === 'function') return c.crypto.randomUUID();
  return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
