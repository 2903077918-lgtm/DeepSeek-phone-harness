// cloud-relay/src/supabase.ts —— 轻量 Supabase/PostgREST 客户端（fetch-based，零第三方依赖）
// 密钥只从环境变量读取（wrangler secret / .dev.vars），本仓库不含任何真实密钥。
// 支持：查询(single/count)、insert、update、delete；行级安全用 service_role key（阶段3 单用户）。

export interface SupabaseEnv {
  SUPABASE_URL: string;              // ex https://<ref>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY: string; // service_role（阶段3 单用户自用全权限；阶段4 改用 RLS+user JWT 收窄）
}

export class SupabaseClient {
  private base: string;
  private key: string;
  constructor(url: string, serviceRoleKey: string) {
    this.base = (url || '').replace(/\/+$/, '') + '/rest/v1';
    this.key = serviceRoleKey;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: this.key,
      Authorization: 'Bearer ' + this.key,
      Prefer: 'return=representation',
    };
  }

  // GET a table with optional query（PostgREST filter），取第一行
  async selectOne<T extends object>(
    table: string,
    query: Record<string, string> = {},
  ): Promise<T | null> {
    const qs = new URLSearchParams(query);
    qs.set('limit', '1');
    const r = await fetch(`${this.base}/${table}?${qs.toString()}`, { headers: this.headers() });
    if (!r.ok) throw new Error(`Supabase selectOne ${table} HTTP ${r.status}`);
    const rows = (await r.json()) as T[];
    return rows.length ? rows[0] : null;
  }

  // GET a table, return all rows
  async selectAll<T extends object>(
    table: string,
    query: Record<string, string> = {},
  ): Promise<T[]> {
    const qs = new URLSearchParams(query);
    const r = await fetch(`${this.base}/${table}?${qs.toString()}`, { headers: this.headers() });
    if (!r.ok) throw new Error(`Supabase selectAll ${table} HTTP ${r.status}`);
    return (await r.json()) as T[];
  }

  async insert<T extends object>(table: string, row: Record<string, unknown>): Promise<T> {
    const r = await fetch(`${this.base}/${table}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(row),
    });
    if (!r.ok) throw new Error(`Supabase insert ${table} HTTP ${r.status}: ${await r.text()}`);
    const rows = (await r.json()) as T[];
    if (!rows.length) throw new Error(`Supabase insert ${table} 未返回行`);
    return rows[0];
  }

  async update<T extends object>(
    table: string,
    id: string,
    patch: Record<string, unknown>,
    idColumn = 'id',
  ): Promise<T | null> {
    const r = await fetch(`${this.base}/${table}?${idColumn}=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(`Supabase update ${table} HTTP ${r.status}: ${await r.text()}`);
    const rows = (await r.json()) as T[];
    return rows.length ? rows[0] : null;
  }
}

export function createSupabase(env: SupabaseEnv): SupabaseClient {
  // 防御：secret 值可能混入 BOM/空白（.dev.vars 带 BOM 时常见），trim 并去掉 \uFEFF
  const url = (env.SUPABASE_URL || '').replace(/^\uFEFF/, '').trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/^\uFEFF/, '').trim();
  return new SupabaseClient(url, key);
}
