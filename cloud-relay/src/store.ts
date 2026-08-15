// cloud-relay/src/store.ts —— 云端数据访问层（基于 SupabaseClient，对齐 schema.sql）
import { SupabaseClient } from './supabase.js';
import type { Device, DeviceStatus, Task, TaskStatus } from './types.js';

/** 通过 Agent 的 agent_id(=deviceId) 查设备（含未绑定） */
export async function getDeviceByAgentId(db: SupabaseClient, agentId: string): Promise<Device | null> {
  return db.selectOne<Device>('devices', { agent_id: `eq.${agentId}` });
}

// 把"agent_id 或设备 UUID"统一解析成 devices.id（UUID）。传入已是 UUID 则原样返回；
// 否则按 agent_id 查表。供所有写 uuid 外键（pair_codes/audit_log/tasks）的方法使用。
export async function resolveDeviceUuid(db: SupabaseClient, idOrAgentId: string): Promise<string | null> {
  const v = String(idOrAgentId || '').trim();
  if (!v) return null;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(v)) return v; // 已是 UUID
  const dev = await getDeviceByAgentId(db, v);
  return dev ? dev.id : null;
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
  // 兼容新调用（senderKey/salt）
  const full = fields as Record<string, unknown> & typeof fields;
  const senderKey = typeof full.senderKey === 'string' ? full.senderKey : undefined;
  const salt = typeof full.salt === 'string' ? full.salt : undefined;
  const deviceUuid = fields.deviceId ? await resolveDeviceUuid(db, fields.deviceId) : null;
  return db.insert<Task>('tasks', {
    user_id: fields.userId ?? null,
    device_id: deviceUuid,
    status: 'queued',
    prompt_cipher: fields.promptCipher,
    risk_level: fields.riskLevel ?? 'low',
    require_confirm: fields.requireConfirm ?? false,
    timeout_ms: fields.timeoutMs ?? 600000,
    sender_key: senderKey ?? null,   // 手机 E2EE 公钥（Agent 据此派生）
    salt: salt ?? null,              // 本次任务 HKDF salt
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
    resultCipher: { ciphertext: string; iv: string; tag: string }; // 对齐 e2ee-web 的 AES-GCM box
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

/** 追加审计日志（deviceId 支持 agent_id 或 UUID，内部解析成设备的 UUID） */
export async function appendAudit(
  db: SupabaseClient,
  fields: { userId?: string; deviceId?: string; action: string; detail?: Record<string, unknown> },
): Promise<void> {
  const devUuid = fields.deviceId ? await resolveDeviceUuid(db, fields.deviceId) : null;
  await db.insert('audit_log', {
    user_id: fields.userId ?? null,
    device_id: devUuid,
    action: fields.action,
    detail: fields.detail ?? null,
    at: new Date().toISOString(),
  });
}

// ================= 账号（阶段3 单用户，WebCrypto PBKDF2 密码哈希，Worker 兼容零依赖） =================
// Cloudflare Workers 的 node:compat 不提供 scryptSync/createHash，故使用标准 WebCrypto：
//   PBKDF2(SHA-256) 派生密码哈希；crypto.subtle.digest 做通用 SHA-256（配对码）。

// Cloudflare Workers 的 WebCrypto PBKDF2 限制迭代次数 ≤ 100000，用 100000（旧哈希按存储的 iter 验证）
const PBKDF2_ITER = 100000;
const PBKDF2_KEYLEN = 32; // 派生 32 字节

function hex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function toBuf(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
async function digestHex(data: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', data));
}

/** 密码 → 存库哈希（pbkdf2$iter$salt$hash，salt 随机 16B） */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', toBuf(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    key, PBKDF2_KEYLEN * 8,
  );
  return `pbkdf2$${PBKDF2_ITER}$${hex(salt)}$1$${hex(bits)}`;
}

/** 校验密码（constant-time compare via 全量比较） */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    // pbkdf2$iter$salt$1$hash
    if (parts[0] !== 'pbkdf2') return false;
    const iter = Number(parts[1]);
    const saltBytes = fromHex(parts[2] ?? ''); // hashPassword 存的是 hex(salt)，需解码回字节
    const expected = fromHex(parts[4] ?? '');
    const key = await crypto.subtle.importKey('raw', toBuf(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations: iter, hash: 'SHA-256' },
      key, PBKDF2_KEYLEN * 8,
    );
    const got = fromHex(hex(bits));
    if (expected.length !== got.length) return false;
    // timing-safe：逐字节异或累加
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ got[i];
    return diff === 0;
  } catch {
    return false;
  }
}
function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(Math.floor(s.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16) || 0;
  return out;
}

export interface UserRow {
  id: string; email: string; password_hash: string; plan: string; status: string;
  created_at: string; updated_at: string;
}

/** 注册账号（邮箱存在则抛错） */
export async function createUser(db: SupabaseClient, email: string, password: string): Promise<UserRow> {
  const existing = await db.selectOne<UserRow>('users', { email: `eq.${email}` });
  if (existing) throw new Error('email taken');
  const passwordHash = await hashPassword(password);
  return db.insert<UserRow>('users', {
    email, password_hash: passwordHash, plan: 'free', status: 'active',
  });
}

/** 按邮箱查用户；校验密码，成功返回 user（不含 password_hash） */
export async function loginUser(db: SupabaseClient, email: string, password: string): Promise<Omit<UserRow, 'password_hash'> | null> {
  const u = await db.selectOne<UserRow>('users', { email: `eq.${email}` });
  if (!u || !(await verifyPassword(password, u.password_hash))) return null;
  const { password_hash: _ph, ...rest } = u;
  return rest;
}

// ================= 配对码（只存哈希；Agent 生成，手机绑定） =================
export interface PairCodeRow {
  id: string; code_hash: string; device_id: string | null;
  expires_at: string; used_at: string | null; used_by_user: string | null; created_at: string;
}

const PAIR_CODE_TTL_MS = 15 * 60 * 1000;          // 15 分钟
const PAIR_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 剔除 O/I/L/0/1
const PAIR_CODE_LEN = 8;

async function sha256Hex(s: string): Promise<string> {
  return digestHex(toBuf(s));
}

/** 生成 8 位配对码（剔除易混淆字符），返回明文 + 存储哈希 */
export async function generatePairCode(): Promise<{ code: string; codeHash: string }> {
  let code = '';
  for (let i = 0; i < PAIR_CODE_LEN; i++) code += PAIR_CODE_ALPHABET[Math.floor(Math.random() * PAIR_CODE_ALPHABET.length)];
  return { code, codeHash: await sha256Hex(code) };
}

/** 存配对准（只存 code_hash；deviceId 为 agent_id，内部解析成 devices.id UUID） */
export async function createPairCode(db: SupabaseClient, agentId: string, codeHash: string): Promise<void> {
  const dev = await getDeviceByAgentId(db, agentId);
  if (!dev) throw new Error('设备不存在: ' + agentId);
  await db.insert('pair_codes', {
    code_hash: codeHash, device_id: dev.id,
    expires_at: new Date(Date.now() + PAIR_CODE_TTL_MS).toISOString(),
  });
}

/** 用配对码把设备绑定到用户：码校验（存在/未用/未过期）→ 绑定 + 标记 used */
export async function pairDeviceWithCode(db: SupabaseClient, agentId: string, code: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  const dev = await getDeviceByAgentId(db, agentId);
  if (!dev) return { ok: false, error: '设备不存在' };
  const codeHash = await sha256Hex((code || '').trim().toUpperCase());
  const row = await db.selectOne<PairCodeRow>('pair_codes', { code_hash: `eq.${codeHash}` });
  if (!row) return { ok: false, error: '配对码不存在' };
  if (row.used_at) return { ok: false, error: '配对码已被使用' };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: '配对码已过期' };
  if (row.device_id !== dev.id) return { ok: false, error: '配对码与设备不匹配' };
  await db.update('pair_codes', row.id, { used_at: new Date().toISOString(), used_by_user: userId });
  // 绑定设备 → user
  await db.update<Device>('devices', dev.id, { user_id: userId, status: 'online', bound_at: new Date().toISOString() });
  return { ok: true };
}

// ================= 任务查询 =================
/** 任务列表：按设备 + 可选状态，返回最新的 limit 条 */
export async function listTasks(
  db: SupabaseClient,
  opts: { deviceId?: string; userId?: string; status?: string; limit?: number },
): Promise<Task[]> {
  const q: Record<string, string> = {};
  if (opts.deviceId) {
    const uuid = await resolveDeviceUuid(db, opts.deviceId); // agent_id 转 UUID 以匹配 tasks.device_id
    if (uuid) q.device_id = `eq.${uuid}`;
    else return [];
  }
  if (opts.userId) q.user_id = `eq.${opts.userId}`;
  if (opts.status) q.status = `eq.${opts.status}`;
  q.order = 'created_at.desc';
  q.limit = String(opts.limit ?? 50);
  return db.selectAll<Task>('tasks', q);
}

/** 任务详情 */
export async function getTaskById(db: SupabaseClient, taskId: string): Promise<Task | null> {
  return db.selectOne<Task>('tasks', { id: `eq.${taskId}` });
}

/** 任务事件回放 */
export async function listTaskEvents(db: SupabaseClient, taskId: string): Promise<Array<{ type: string; payload: unknown; at: string }>> {
  return db.selectAll<{ type: string; payload: unknown; at: string }>('task_events', {
    task_id: `eq.${taskId}`, order: 'id.asc', limit: '200',
  });
}

