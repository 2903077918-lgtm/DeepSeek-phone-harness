// cloud-relay/src/store.ts —— 云端数据访问层（基于 SupabaseClient，对齐 schema.sql）
import { SupabaseClient } from './supabase.js';
import type { Device, DeviceStatus, Task, TaskStatus } from './types.js';

/** 通过 Agent 的 agent_id(=deviceId) 查设备（含未绑定） */
export async function getDeviceByAgentId(db: SupabaseClient, agentId: string): Promise<Device | null> {
  return db.selectOne<Device>('devices', { agent_id: `eq.${encodeURIComponent(agentId)}` });
}

/** 设备注册 / 上报（Agent hello 时 upsert：存在则更新状态/公钥，不存在则插入 unbound） */
export async function upsertDevice(
  db: SupabaseClient,
  agentId: string,
  fields: { name?: string; os?: string; arch?: string; version?: string; publicKeyX25519?: string },
): Promise<Device> {
  const existing = await getDeviceByAgentId(db, agentId);
  if (existing) {
    const patch: Record<string, unknown> = {
      status: 'online',
      last_seen_at: new Date().toISOString(),
    };
    if (fields.os) patch.os = fields.os;
    if (fields.arch) patch.arch = fields.arch;
    if (fields.version) patch.version = fields.version;
    if (fields.publicKeyX25519) patch.public_key_x25519 = fields.publicKeyX25519;
    const updated = await db.update<Device>('devices', existing.id, patch);
    return updated ?? existing;
  }
  return db.insert<Device>('devices', {
    agent_id: agentId,
    name: fields.name ?? agentId,
    os: fields.os ?? null,
    arch: fields.arch ?? null,
    version: fields.version ?? null,
    public_key_x25519: fields.publicKeyX25519 ?? null,
    status: 'online',
    last_seen_at: new Date().toISOString(),
  });
}

/** 标记设备离线 / killed */
export async function setDeviceStatus(db: SupabaseClient, deviceId: string, status: DeviceStatus): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === 'killed') patch.kill_until = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 默认 1h kill
  await db.update<Device>('devices', deviceId, patch);
}

/** 创建任务（E2EE prompt 密文；user/device 绑定） */
export async function createTask(
  db: SupabaseClient,
  fields: {
    userId?: string;
    deviceId?: string;
    promptCipher: { ciphertext: string; nonce: string; tag: string };
    riskLevel?: string;
    requireConfirm?: boolean;
    timeoutMs?: number;
  },
): Promise<Task> {
  return db.insert<Task>('tasks', {
    user_id: fields.userId ?? null,
    device_id: fields.deviceId ?? null,
    status: 'queued',
    prompt_cipher: fields.promptCipher,
    risk_level: fields.riskLevel ?? 'low',
    require_confirm: fields.requireConfirm ?? false,
    timeout_ms: fields.timeoutMs ?? 600000,
    created_at: new Date().toISOString(),
  });
}

/** 更新任务状态（写 task_events 一并由调用方处理，这里只更新任务行） */
export async function updateTaskStatus(db: SupabaseClient, taskId: string, status: TaskStatus): Promise<Task | null> {
  const patch: Record<string, unknown> = { status };
  if (status === 'running') patch.started_at = new Date().toISOString();
  if (['succeeded', 'failed', 'cancelled', 'timeout'].includes(status)) patch.finished_at = new Date().toISOString();
  return db.update<Task>('tasks', taskId, patch);
}

/** 保存任务结果（E2EE result 密文 + 终态） */
export async function finishTask(
  db: SupabaseClient,
  taskId: string,
  fields: {
    status: TaskStatus;
    resultCipher: { ciphertext: string; nonce: string; tag: string };
    elapsedMs: number;
    exitCode: number;
  },
): Promise<Task | null> {
  return db.update<Task>('tasks', taskId, {
    status: fields.status,
    result_cipher: fields.resultCipher,
    finished_at: new Date().toISOString(),
    elapsed_ms: fields.elapsedMs,
    exit_code: fields.exitCode,
  });
}

/** 追加任务事件（全生命周期，可回放） */
export async function appendTaskEvent(db: SupabaseClient, taskId: string, type: string, payload: Record<string, unknown>): Promise<void> {
  await db.insert('task_events', { task_id: taskId, type, payload, at: new Date().toISOString() });
}

/** 追加审计日志 */
export async function appendAudit(
  db: SupabaseClient,
  fields: { userId?: string; deviceId?: string; action: string; detail?: Record<string, unknown> },
): Promise<void> {
  await db.insert('audit_log', {
    user_id: fields.userId ?? null,
    device_id: fields.deviceId ?? null,
    action: fields.action,
    detail: fields.detail ?? null,
    at: new Date().toISOString(),
  });
}
