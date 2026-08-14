// cloud-relay/src/bindings.ts —— Worker 环境绑定与 secret（部署时由 wrangler secret / .dev.vars 注入）
import type { DurableObjectNamespace } from '@cloudflare/workers-types';

export interface Env {
  RELAY_DO: DurableObjectNamespace;
  // Supabase（阶段3 接 store.ts 时使用；值为 secret，不落在仓库）
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  // 可选：绑定的域名/前缀（部署留白）
  BASE_URL?: string;
}
