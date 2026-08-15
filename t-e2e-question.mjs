// 端到端验证：提问卡 中继（question/requested → /api/approvals → 回答 → run 完成）
// 用法：node t-e2e-question.mjs [task]
const TOK = process.env.PH_TOKEN || '请设置环境变量 PH_TOKEN';
const BASE = 'http://127.0.0.1:8788';
const task = process.argv[2] || '请直接回复四个字：链路OK，不要提问，不要调用任何工具。';

const h = { 'content-type': 'application/json', authorization: 'Bearer ' + TOK };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(path, opts = {}) {
  const r = await fetch(BASE + path, { headers: h, ...opts });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
}

// 1. 新建会话
const s = await j('/api/sessions', { method: 'POST', body: '{}' });
if (!s.body.ok) { console.log('FAIL create session:', JSON.stringify(s.body)); process.exit(1); }
const sid = s.body.sessionId;
console.log('session:', sid);

// 2. 后台发任务
const runner = (async () => {
  const started = Date.now();
  const r = await fetch(BASE + '/api/dsh-continue', {
    method: 'POST', headers: h,
    body: JSON.stringify({ sessionId: sid, task }),
  });
  const txt = await r.text();
  return { ms: Date.now() - started, status: r.status, body: (() => { try { return JSON.parse(txt); } catch { return txt.slice(0, 300); } })() };
})();

// 3. 轮询提问/审批，有提问就回答（选择第一个选项或填自定义文字）
let answered = 0;
for (let i = 0; i < 60; i++) {
  const p = await j('/api/approvals');
  const items = (p.body && p.body.items) || [];
  const mine = items.filter((a) => !a.sessionId || a.sessionId === sid);
  for (const a of mine) {
    if (a.kind === 'question' && !a._handled) {
      a._handled = true;
      const qs = a.questions || [];
      const answers = qs.map((q, qi) => {
        const opts = q.options || [];
        if (opts.length) return { id: q.id, selected: [opts[0].label] };
        return { id: q.id, custom: '继续执行' };
      });
      console.log(`[${i * 3}s] 回答问题 #${++answered}:`, JSON.stringify(answers).slice(0, 160));
      const rr = await j('/api/approvals', { method: 'POST', body: JSON.stringify({ questionKey: a.questionKey, answer: { answers } }) });
      console.log('  respond:', rr.status, JSON.stringify(rr.body));
    }
    if (a.kind !== 'question' && !a._handled) {
      a._handled = true;
      console.log(`[${i * 3}s] 审批 #${++answered}:`, a.reason || a.toolName);
      const rr = await j('/api/approvals', { method: 'POST', body: JSON.stringify({ approvalId: a.approvalId, outcome: 'allowed-once' }) });
      console.log('  respond:', rr.status, JSON.stringify(rr.body));
    }
  }
  // 已结束？
  if (answered > 0 && mine.length === 0 && !runnerDone()) break;
  await sleep(3000);
}
function runnerDone() { return false; }

// 4. 等任务结束（最多 150s）
const res = await Promise.race([
  runner,
  sleep(150000).then(() => ({ timeout: true })),
]);
console.log('=== runner ===');
console.log(JSON.stringify(res, null, 2).slice(0, 1200));

// 5. 读最终历史
const hist = await j('/api/dsh-history?sessionId=' + sid);
const msgs = (hist.body && (hist.body.messages || hist.body.items)) || [];
console.log('=== history (' + msgs.length + ') ===');
msgs.slice(-4).forEach((m) => console.log('[' + m.role + '] ' + String(m.text).slice(0, 120).replace(/\n/g, ' ')));
