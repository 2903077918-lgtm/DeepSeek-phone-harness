// 集成验证：会话连续性 + 新 UI + history 过滤
// 用法：node test-integration.mjs <token>
import { readFileSync } from 'node:fs';

const token = process.argv[2] || JSON.parse(readFileSync('C:/Users/Joey/Documents/phone-harness/config.json', 'utf8')).token;
const base = 'http://127.0.0.1:8788';
const h = { 'content-type': 'application/json', authorization: 'Bearer ' + token };

async function api(path, opts = {}) {
  const r = await fetch(base + path, { ...opts, headers: h });
  return r.json();
}

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log((cond ? '✅' : '❌'), name, detail ? '| ' + detail : '');
}

// 1. 新 UI
const page = await (await fetch(base + '/', { headers: { authorization: 'Bearer ' + token } })).text();
check('UI 为深色对话流（含用户/助手气泡样式）', page.includes('#4D6BFE') || page.includes('4D6BFE'), '品牌色检测');
check('UI 含会话管理', page.includes('sessions') || page.includes('新会话'), '');

// 2. 会话列表 API
const sessions = await api('/api/sessions');
check('/api/sessions 可用', sessions.ok && Array.isArray(sessions.items), JSON.stringify(sessions).slice(0, 100));

// 3. 新建会话
const created = await api('/api/sessions', { method: 'POST' });
const sid = created.sessionId || created.result?.sessionId;
check('/api/sessions POST 新建', !!sid, 'sessionId=' + sid);

// 4. 会话连续性：第一条记住词
const e1 = await api('/api/exec', { method: 'POST', body: JSON.stringify({ task: '记住一个词：集成验证', sessionId: sid }) });
check('exec 带 sessionId 成功', e1.ok && e1.result?.ok, 'backend=' + e1.result?.backend + ' sessionId=' + e1.result?.sessionId);

// 5. 会话连续性：第二条引用（等第一条完成后）
await new Promise(r => setTimeout(r, 8000));
const e2 = await api('/api/exec', { method: 'POST', body: JSON.stringify({ task: '我刚才让你记住什么词？只回答那个词', sessionId: sid }) });
check('第二条 exec 成功', e2.ok && e2.result?.ok, 'backend=' + e2.result?.backend);
const out2 = (e2.result?.stdout || '').trim();
check('上下文记忆生效（回答含"集成验证"）', out2.includes('集成验证'), '回答=' + out2.slice(0, 50));

// 6. history 按会话过滤
const histAll = await api('/api/history');
const histFiltered = await api('/api/history?sessionId=' + sid);
check('/api/history 按 sessionId 过滤', histFiltered.ok && Array.isArray(histFiltered.items), 
  '全部=' + (histAll.items?.length ?? 0) + ' 过滤后=' + (histFiltered.items?.length ?? 0));

console.log('\n===== 汇总 =====');
const passed = results.filter(r => r.ok).length;
console.log(`${passed}/${results.length} 通过`);
if (passed < results.length) {
  console.log('未通过项:');
  results.filter(r => !r.ok).forEach(r => console.log('  -', r.name, r.detail));
  process.exit(1);
}
