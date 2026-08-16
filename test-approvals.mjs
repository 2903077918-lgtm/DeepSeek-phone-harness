// 审批功能集成验证
// 用法：node test-approvals.mjs
import { readFileSync } from 'node:fs';
import { agentReady } from './test-utils/agent-ready.mjs';

const token = JSON.parse(readFileSync('C:/Users/Joey/Documents/phone-harness/config.json', 'utf8')).token;
const base = 'http://127.0.0.1:8788';
const h = { 'content-type': 'application/json', authorization: 'Bearer ' + token };

// 前置：agent 未启动时给出清晰提示而非 fetch 抛错
await agentReady(token);

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond });
  console.log((cond ? '✅' : '❌'), name, detail ? '| ' + detail : '');
}

// 1. GET /api/approvals（应返回 ok + items 数组，即使为空）
const a1 = await (await fetch(base + '/api/approvals', { headers: h })).json();
check('GET /api/approvals 可用', a1.ok && Array.isArray(a1.items), 'items=' + (a1.items?.length ?? '?'));

// 2. POST /api/approvals 无效 outcome → 400
const bad = await (await fetch(base + '/api/approvals', {
  method: 'POST', headers: h, body: JSON.stringify({ approvalId: 'x', outcome: 'maybe' }),
})).json();
check('无效 outcome 被拒绝', bad.ok === false, JSON.stringify(bad).slice(0, 80));

// 3. 未授权 → 401
const noauth = await (await fetch(base + '/api/approvals', { headers: { 'content-type': 'application/json' } })).json();
check('无 token 返回 401', noauth.ok === false || noauth.error === 'unauthorized', JSON.stringify(noauth).slice(0, 60));

console.log('\n===== 汇总 =====');
const passed = results.filter(r => r.ok).length;
console.log(`${passed}/${results.length} 通过`);
if (passed < results.length) process.exit(1);
