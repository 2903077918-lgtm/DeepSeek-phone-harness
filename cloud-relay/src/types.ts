// cloud-relay/src/types.ts —— 云端实体类型（对齐 supabase/schema.sql）

export type DeviceStatus = 'unbound' | 'online' | 'offline' | 'killed';
export type TaskStatus = 'queued' | 'sent' | 'confirming' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';

/** 设备（对应 devices 表） */
export interface Device {
  id: string; // 云端侧 UUID
  agent_id: string; // Agent 稳定 ID（= deviceId）
  user_id?: string | null;
  name?: string | null;
  os?: string | null;
  arch?: string | null;
  version?: string | null;
  public_key_x25519?: string | null; // JWK x base64url
  status: DeviceStatus;
  last_seen_at?: string | null;
  kill_until?: string | null;
  bound_at?: string | null;
  created_at: string;
}

/** 任务（对应 tasks 表；prompt/result 为 E2EE 密文） */
export interface Task {
  id: string;
  user_id?: string | null;
  device_id?: string | null;
  status: TaskStatus;
  prompt_cipher?: { ciphertext: string; nonce: string; tag: string } | null;
  result_cipher?: { ciphertext: string; nonce: string; tag: string } | null;
  mode: 'headless' | 'web';
  risk_level?: string | null;
  require_confirm?: boolean;
  confirm_decision?: string | null;
  priority?: string | null;
  timeout_ms?: number | null;
  tool_calls?: unknown[] | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  elapsed_ms?: number | null;
  exit_code?: number | null;
}

/** 待确认请求（confirm.request 的承载；task 附带） */
export interface ConfirmRequest {
  requestId: string;
  taskId: string;
  prompt: string;
  riskSummary: string;
  riskLevel: 'low' | 'medium' | 'high';
  expiresAt: string;
}
