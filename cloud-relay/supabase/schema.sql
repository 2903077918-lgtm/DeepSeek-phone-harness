-- cloud-relay 需要独立 Supabase 数据库（不复用 voltex 的库）。
-- 在 Supabase 控制台新建空项目后，在本地运行：
--   supabase link --project-ref <ref>   （或在控制台 SQL Editor 粘贴执行）
--   pnpm exec supabase db push  /  或直接在 SQL Editor 运行本文件
-- 设计对应 docs/architecture/cloud-architecture.md 第 4.3 节数据模型。

-- ============ users（账号） ============
create table if not exists public.users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  password_hash text not null,
  plan        text not null default 'free',          -- free | pro | power
  status      text not null default 'active',        -- active | disabled
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============ devices（设备，由 Agent 生成 deviceId） ============
create table if not exists public.devices (
  id               uuid primary key default gen_random_uuid(),   -- 云端侧 ID
  agent_id         text unique not null,                          -- Agent 稳定 ID（= deviceId）
  user_id          uuid references public.users(id),              -- NULL = 未绑定
  name             text,
  os               text,
  arch             text,
  version          text,
  public_key_x25519 text,                                          -- E2EE 公钥（JWK x base64url）
  status           text not null default 'unbound',                -- unbound|online|offline|killed
  last_seen_at     timestamptz,
  kill_until       timestamptz,
  bound_at         timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_devices_user  on public.devices(user_id);
create index if not exists idx_devices_agent on public.devices(agent_id);

-- ============ pair_codes（配对码，只存哈希） ============
create table if not exists public.pair_codes (
  id           uuid primary key default gen_random_uuid(),
  code_hash    text unique not null,          -- sha256(pairCode)，只存哈希
  device_id    uuid references public.devices(id),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  used_by_user uuid references public.users(id),
  created_at   timestamptz not null default now()
);

-- ============ tasks（任务；prompt/result 存储为 E2EE 密文，云端不可读） ============
create table if not exists public.tasks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references public.users(id),
  device_id      uuid references public.devices(id),
  status         text not null default 'queued',
                 -- queued|sent|confirming|running|succeeded|failed|cancelled|timeout
  prompt_cipher  jsonb,          -- {ciphertext, nonce, tag}  E2EE
  result_cipher  jsonb,
  mode           text not null default 'headless',  -- headless | web
  risk_level     text,
  require_confirm boolean not null default false,
  confirm_decision text,
  priority       text not null default 'normal',
  timeout_ms     int,
  tool_calls     jsonb,          -- 审计摘要（不含完整输出）
  sender_key     text,           -- 手机 E2EE 公钥（Agent 轮询据此 ECDH 派生）
  salt           text,           -- 本次任务 HKDF salt
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  elapsed_ms     int,
  exit_code      int
);
create index if not exists idx_tasks_user   on public.tasks(user_id, created_at desc);
create index if not exists idx_tasks_device on public.tasks(device_id, status);

-- ============ task_events（任务生命周期事件，可回放） ============
create table if not exists public.task_events (
  id       bigserial primary key,
  task_id  uuid references public.tasks(id),
  type     text not null,
  payload  jsonb,
  at       timestamptz not null default now()
);
create index if not exists idx_task_events_task on public.task_events(task_id, id);

-- ============ tokens（access/refresh/device/resume 的哈希） ============
create table if not exists public.tokens (
  hash       text primary key,      -- sha256(token)
  user_id    uuid references public.users(id),
  device_id  uuid references public.devices(id),
  kind       text not null,         -- access|refresh|device|resume
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_tokens_user on public.tokens(user_id);

-- ============ audit_log（登录/绑定/任务/确认/kill 全生命周期） ============
create table if not exists public.audit_log (
  id         bigserial primary key,
  user_id    uuid,
  device_id  uuid,
  action     text not null,
  detail     jsonb,
  ip         inet,
  user_agent text,
  at         timestamptz not null default now()
);
create index if not exists idx_audit_user on public.audit_log(user_id, at desc);

-- ============ RLS：最小权限、按用户隔离（阶段3 单用户自用先宽松，阶段4 收紧） ============
alter table public.devices    enable row level security;
alter table public.tasks      enable row level security;
alter table public.task_events enable row level security;
alter table public.tokens     enable row level security;
alter table public.audit_log  enable row level security;

-- 阶段3（单用户自用）用 service_role key（RLS 不生效）；上多租户后按 user_id 建 policy。
-- 占位 policy，阶段 4 按需完善（CREATE POLICY 无 IF NOT EXISTS，重跑需先 drop）：
-- drop policy if exists p_devices_all on public.devices;
create policy p_devices_all on public.devices for all using (true) with check (true);
