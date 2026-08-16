// test-utils/agent-ready.mjs —— 集成测试前置检测：确认电脑端 Agent 在 8788 可达后再继续
// 用法：await agentReady(token) → 可达返回 true；不可达打印清晰错误并退出码 1。
// 避免 agent 未启动时 fetch 直接抛错 / 误报失败。
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const AGENT_BASE = process.env.AGENT_BASE || 'http://127.0.0.1:8788';

/** 解析 token：优先入参，其次 env，最后 config.json */
export function resolveToken(tokenFromCli) {
  if (tokenFromCli) return tokenFromCli;
  if (process.env.RELAY_TOKEN) return process.env.RELAY_TOKEN;
  try {
    const cfg = JSON.parse(readFileSync(pathToFileURL(process.cwd() + '/config.json')));
    return cfg.token;
  } catch {
    return null;
  }
}

/** 前置探测（超时 3s），返回 {ok, status?, error?} */
export async function probeAgent(token) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    const r = await fetch(AGENT_BASE + '/api/status', { headers, signal: ctrl.signal });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '连接超时' : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** 主入口：不可达则报错退出 */
export async function agentReady(tokenFromCli) {
  const token = resolveToken(tokenFromCli);
  const p = await probeAgent(token);
  if (p.ok) return { ok: true, token, status: p.status };
  console.error('');
  console.error(`[agent-not-ready] ${AGENT_BASE} 不可达（${p.error || ('HTTP ' + p.status)}）。`);
  console.error('请先启动 Agent：node agent.mjs --mode=both（或 start-agent.ps1），再运行本集成测试。');
  console.error('');
  process.exit(1);
}
