// cloud-relay/api/index.ts —— Vercel Function 入口（部署到 Vercel；当前生产走 Cloudflare Worker）
// 把 cloud-relay 的 fetch handler 适配为 Vercel Function：从 process.env 读取 Supabase 连接。
// ⚠️ Vercel Node 函数桥接层：普通 `(request)=>Response` 默认导出会被当 (req,res) 直接调用，
// 返回值被丢弃导致请求悬挂超时。因此这里用 Express 风格 (req,res)，内部把 req 包装成标准 Request
// 调 cloudRelay.fetch，再写回 res。
import cloudRelay from '../src/index.js';

// @ts-ignore 项目 tsconfig types=workers-types；Vercel Node 运行时才有 process，这里用全局弱类型访问
declare const process: { env: Record<string, string | undefined> } | undefined;

export default async function handler(
  req: { method?: string; url?: string; headers?: Record<string, string | string[] | undefined> },
  res: {
    status(code: number): { json(data: unknown): void };
    setHeader(name: string, value: string): void;
    end(body?: string): void;
  },
): Promise<void> {
  try {
    const supabaseUrl = process?.env?.SUPABASE_URL;
    const supabaseKey = process?.env?.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未配置' });
      return;
    }
    // 把 Express req 转成标准 Request（Vercel 传的 req 兼容 fetch Request 子集）
    const hdrs = new Headers();
    if (req.headers && typeof req.headers === 'object') {
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') hdrs.set(k, v);
        else if (Array.isArray(v)) v.forEach((x) => hdrs.append(k, x));
      }
    }
    const rawUrl = req.url || '/';
    // Vercel 传的 req.url 是相对路径（如 /v1/status），补成完整 URL 才能 new Request
    const url = rawUrl.startsWith('http') ? rawUrl : 'https://vercel.com' + (rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl);

    // 读 body：Vercel 的 req.body getter 可能抛 Invalid JSON，原始字节在流的 _readableState.buffer 里
    // （Vercel restoreBody 写入）。从这里拼出原始 JSON；失败则空 body。
    let bodyObj: Record<string, unknown> = {};
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        const rs = (req as unknown as { _readableState?: { buffer?: Array<{ type: string; data: number[] } | Buffer> } })._readableState;
        let raw = '';
        if (rs && Array.isArray(rs.buffer)) {
          const chunks = rs.buffer
            .map((c) => Buffer.isBuffer(c) ? c : Buffer.from((c as { data: number[] }).data ?? []))
            .filter((b) => b.length > 0);
          raw = Buffer.concat(chunks).toString('utf8');
        }
        if (!raw) {
          raw = await new Promise<string>((resolve, reject) => {
            const src = req as unknown as { on(e: string, cb: (c?: unknown) => void): void };
            if (typeof src.on !== 'function') { resolve(''); return; }
            let buf = '';
            src.on('data', (c) => { buf += Buffer.from(c as Buffer).toString('utf8'); });
            src.on('end', () => resolve(buf));
            src.on('error', reject);
          });
        }
        if (raw.trim()) { try { bodyObj = JSON.parse(raw); } catch { /* ignore */ } }
      } catch { /* body 读取失败当空 body */ }
    }
    const request = new Request(url, {
      method: req.method || 'GET',
      headers: hdrs,
      body: Object.keys(bodyObj).length ? JSON.stringify(bodyObj) : undefined,
    });

    const env = { SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: supabaseKey };
    const response = await cloudRelay.fetch(request, env);
    for (const [k, v] of response.headers.entries()) res.setHeader(k, v);
    res.status(response.status).end(await response.text());
  } catch (e) {
    res.status(500).json({ error: 'handler-error', message: e instanceof Error ? e.message : String(e) });
  }
}
