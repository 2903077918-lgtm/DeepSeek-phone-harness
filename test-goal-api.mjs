// test-goal-api.mjs —— 目标(goal) API 单测：getSessionGoal / mutateGoal
// 覆盖 src/executor.js 未提交改动：getSessionGoal 把 projections.values.goal 拍平成 goal{id,revision,...}
// （附带 meta 原始投影）；mutateGoal 的 edit/pause/resume/complete/clear 在**前端不传 ref** 时自动从
// 投影里取当前 goal 作为 ref（避免 clear 等传空 ref 校验失败）。
// 用本机 mock DSH RPC server（node:http）取代真实 DSH，确定性、不碰真实 DSH 状态、无需网络。
// 运行：node --experimental-strip-types test-goal-api.mjs（DSH_WEB_API_BASE 由脚本在导入 executor 前临时设置）
import { createServer } from 'node:http';

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond });
  console.log((cond ? '✅' : '❌'), name, detail ? '| ' + detail : '');
}

// ---------- mock DSH RPC server ----------
// 只实现本单测需要的 RPC：session.list / session.create / goal.create|edit|pause|resume|complete|clear
// 语义对齐 DSH：goal 状态存 projections.values.goal = {goal:{id,revision,...}, phase,...}，
// 每次 mutation revision+1。payload 信封 {type:'client-request', rpcId, method, payload} → {result:{ok,value}}。
const st = { goalState: null, sessionIds: [] };

function responder(method, payload) {
  const proj = st.goalState;
  const flatGoal = proj && proj.goal ? proj.goal : null;
  const bump = (patch = {}) => {
    if (!st.goalState) return null;
    st.goalState.goal = { ...st.goalState.goal, ...patch, revision: (st.goalState.goal.revision || 0) + 1 };
    return st.goalState;
  };

  switch (method) {
    case 'session.list':
      return { items: st.sessionIds.map((sessionId) => ({
        sessionId,
        projections: { values: { goal: st.goalState } },
      })) };
    case 'session.create': {
      const sessionId = 'session-mock-' + (st.sessionIds.length + 1);
      st.sessionIds.push(sessionId);
      return { sessionId };
    }
    case 'goal.create': {
      st.goalState = {
        goal: { id: 'goal-mock-1', revision: 1, objective: payload.objective, phase: 'active', maxGoalRounds: payload.maxGoalRounds },
        roundsStarted: 0, ref: payload.ref || null,
      };
      return { ref: { id: st.goalState.goal.id, revision: 1 } };
    }
    case 'goal.pause': { bump({ phase: 'paused' }); return { ref: ref() }; }
    case 'goal.resume': { bump({ phase: 'active' }); return { ref: ref() }; }
    case 'goal.edit': { bump({ phase: 'active', objective: payload.objective, maxGoalRounds: payload.maxGoalRounds }); return { ref: ref() }; }
    case 'goal.clear': { st.goalState = null; return { cleared: true }; }
    case 'goal.complete': { bump({ phase: 'complete' }); return { ref: ref() }; }
    default:
      return { error: 'unknown method ' + method };
  }
  function ref() {
    return st.goalState && st.goalState.goal ? { id: st.goalState.goal.id, revision: st.goalState.goal.revision } : null;
  }
}

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let method = '', payload = {};
    try {
      const j = JSON.parse(body || '{}');
      method = j.method || '';
      payload = j.payload || {};
    } catch { /* ignore */ }
    const value = responder(method, payload);
    const hasErr = 'error' in (value || {});
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ result: hasErr ? { ok: false, error: (value || {}).error } : { ok: true, value } }));
  });
});

// ---------- 主流程 ----------
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
// 必须在导入 src/executor.js 之前设置：dsh-utils 的 WEB_API_BASE 是在模块加载时求值的 const
process.env.DSH_WEB_API_BASE = `http://127.0.0.1:${port}`;
const { createExecutor } = await import('./src/executor.js');
const exec = createExecutor({ mode: 'lan' });

async function main() {
  // 1) 方法暴露
  check('getSessionGoal + mutateGoal 已暴露', typeof exec.getSessionGoal === 'function' && typeof exec.mutateGoal === 'function');

  // 2) 空 sessionId 护栏
  const empty = await exec.getSessionGoal('');
  check('getSessionGoal("") → bad-request', empty.ok === false && empty.code === 'bad-request');

  // 3) session.create + goal.create（带 ref 返回）
  const sid = await createSessionId();
  check('mock session.create 得到 sessionId', !!sid);

  const createRes = await exec.mutateGoal({ action: 'create', sessionId: sid, objective: 'TEST-GOAL', maxGoalRounds: 5 });
  check('mutateGoal create → ok + ref', createRes.ok === true && !!createRes.ref, JSON.stringify(createRes.ref));

  // 4) getSessionGoal 拍平：goal{id,revision,...} + meta 原始投影
  const g1 = await exec.getSessionGoal(sid);
  check('getSessionGoal ok + goal 字段', g1.ok === true && g1.goal && g1.goal.id === 'goal-mock-1' && typeof g1.goal.revision === 'number');
  check('meta 携带原始投影(roundsStarted)', g1.meta && g1.meta.roundsStarted !== undefined, JSON.stringify({ roundsStarted: g1.meta && g1.meta.roundsStarted }));

  // 5) 不传 ref：pause → 自动取投影 ref（revision+1）
  const pauseRes = await exec.mutateGoal({ action: 'pause', sessionId: sid });
  check('pause 不传 ref → ok + ref', pauseRes.ok === true && pauseRes.ref && pauseRes.ref.id === 'goal-mock-1' && pauseRes.ref.revision === 2, JSON.stringify(pauseRes.ref));

  // 6) resume 不传 ref
  const resumeRes = await exec.mutateGoal({ action: 'resume', sessionId: sid });
  check('resume 不传 ref → ok + ref(rev3)', resumeRes.ok === true && resumeRes.ref && resumeRes.ref.revision === 3);

  // 7) edit 不传 ref（改 objective + rounds）
  const editRes = await exec.mutateGoal({ action: 'edit', sessionId: sid, objective: 'TEST-GOAL-EDITED', maxGoalRounds: 7 });
  check('edit 不传 ref → ok(rev4)', editRes.ok === true && editRes.ref && editRes.ref.revision === 4);

  // 8) complete 不传 ref → 投影 phase=complete
  const completeRes = await exec.mutateGoal({ action: 'complete', sessionId: sid });
  check('complete 不传 ref → ok(rev5)', completeRes.ok === true && completeRes.ref && completeRes.ref.revision === 5);
  const gc = await exec.getSessionGoal(sid);
  check('projection phase=complete', gc.goal && gc.goal.phase === 'complete', JSON.stringify(gc.goal && gc.goal.phase));

  // 9) clear 不传 ref → 清空投影
  const clearRes = await exec.mutateGoal({ action: 'clear', sessionId: sid });
  check('clear 不传 ref → ok', clearRes.ok === true && clearRes.cleared === true);
  const gcl = await exec.getSessionGoal(sid);
  check('clear 后 goal=null', gcl.ok === true && gcl.goal == null);

  // 10) 清空后再 edit（无目标）→ 护栏 bad-request，不崩
  const editNoGoal = await exec.mutateGoal({ action: 'edit', sessionId: sid, objective: 'X' });
  check('无目标时 edit → guarded bad-request', editNoGoal.ok === false && editNoGoal.code === 'bad-request', JSON.stringify(editNoGoal));

  // 11) 非法 action 拒绝
  const badAct = await exec.mutateGoal({ action: 'bogus', sessionId: sid });
  check('非法 action → bad-request', badAct.ok === false && badAct.code === 'bad-request');

  // 12) create 传非法 rounds（0）忽略
  const createBadRounds = await exec.mutateGoal({ action: 'create', sessionId: sid, objective: 'O2', maxGoalRounds: 0 });
  check('create rounds=0 被忽略仍成功', createBadRounds.ok === true);

  report();
}

async function createSessionId() {
  // 直接向 mock server 调 session.create（与真实客户端相同信封），避免依赖本地未导出方法
  const resp = await fetch(`http://127.0.0.1:${port}/api/session.create`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'mock', method: 'session.create', payload: {} }),
  });
  const j = await resp.json();
  return j.result?.value?.sessionId || null;
}

function report() {
  console.log('\n===== 汇总 =====');
  const passed = results.filter((x) => x.ok).length;
  console.log(`${passed}/${results.length} 通过`);
  server.close();
  if (passed < results.length) {
    results.filter((x) => !x.ok).forEach((x) => console.log('  -', x.name));
    process.exit(1);
  }
}

// 清理：进程结束时 server 在 report() 里已 close
main().catch((e) => { console.error('FATAL', e); server.close(); process.exit(1); });
