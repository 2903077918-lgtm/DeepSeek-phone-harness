// test-cloud-service.mjs —— Agent 云端接线器（cloud-service.mjs）单测
// 用 mock transport + mock executor + P-256 E2EE 验证：明文任务流转、E2EE 加解密、风险分级+确认。
// 不连真实网络。用法：node test-cloud-service.mjs
import { createCloudService } from './src/cloud-service.mjs';
import {
  generateKeyPair, deriveSessionKey, encrypt, decrypt, generateKeySalt,
} from './src/e2ee-web.js';
import { MSG_TYPES } from './src/protocol.js';

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log((cond ? '✅' : '❌'), name, detail ? '| ' + detail : '');
}

function mockTransport() {
  const sent = [];
  const listeners = { message: [] };
  return {
    sent,
    on(ev, cb) { (listeners[ev] ||= []).push(cb); },
    off(ev, cb) { listeners[ev] = (listeners[ev] || []).filter((x) => x !== cb); },
    recv(env) { for (const cb of listeners.message) cb(env); },
    sendStatus(taskId, status, extra = {}) { sent.push({ type: MSG_TYPES.TASK_STATUS, payload: { taskId, status, ...extra } }); },
    sendResult(taskId, result, extra = {}) { sent.push({ type: MSG_TYPES.TASK_RESULT, payload: { taskId, ...result, ...extra } }); },
    sendAck(id) { sent.push({ type: MSG_TYPES.TASK_ACK, payload: { msgId: id } }); },
    sendRaw(type, payload, track) { sent.push({ type, payload }); return { type, payload }; },
  };
}
function mockExecutor() {
  const calls = [];
  return {
    calls,
    async run(prompt, opts) { calls.push({ prompt, opts }); return { ok: true, exitCode: 0, stdout: '执行:' + prompt, stderr: '', elapsedMs: 42, backend: 'headless' }; },
    async cancelSession(id) { return { ok: true, cancel: id }; },
  };
}

// ---- 测试1：明文 TASK_SUBMIT → executor → sendResult ----
{
  const t = mockTransport(); const ex = mockExecutor();
  const svc = createCloudService({ transport: t, executor: ex, confirmPolicy: 'never', config: {}, log: { info(){}, warn(){}, error(){} } });
  t.recv({ v: 1, type: MSG_TYPES.TASK_SUBMIT, msgId: 'm1', seq: 1, payload: { taskId: 'tsk_1', prompt: '检查 C 盘空间', requireConfirm: false } });
  await new Promise((r) => setTimeout(r, 20));
  check('明文任务调用 executor', ex.calls.length === 1 && ex.calls[0].prompt === '检查 C 盘空间');
  check('发出 task.result', t.sent.some((s) => s.type === MSG_TYPES.TASK_RESULT && s.payload.taskId === 'tsk_1'));
}

// ---- 测试2：手机(E2EE)加密任务 → Agent 动态解密执行 → 加密结果 ----
{
  const phone = await generateKeyPair();   // 手机 P-256 密钥对
  const agent = await generateKeyPair();   // Agent P-256 密钥对（本机持有私钥）
  const salt = generateKeySalt();
  // 手机端派生密钥并加密任务，携带 senderKey(手机公钥)+salt
  const phoneKey = await deriveSessionKey(phone.privateKey, agent.publicKey, salt);
  const aad = 'tsk_e2e';
  const promptCipher = await encrypt(phoneKey, '删除临时文件', aad);

  const t = mockTransport(); const ex = mockExecutor();
  const svc = createCloudService({
    transport: t, executor: ex, confirmPolicy: 'never',
    config: { cloud: { e2ee: { privateKey: agent.privateKey } } },
    log: { info(){}, warn(){}, error(){} },
  });
  t.recv({ v: 1, type: MSG_TYPES.TASK_SUBMIT, msgId: 'm2', seq: 2,
    payload: { taskId: 'tsk_e2e', promptCipher, senderKey: phone.publicKey, salt, requireConfirm: false } });
  await new Promise((r) => setTimeout(r, 30));
  check('E2EE 密文被 Agent 解密后执行', ex.calls.length === 1 && ex.calls[0].prompt === '删除临时文件');

  // 结果是否加密：Agent 用同一任务密钥加密 result_cipher，手机应能解密
  const res = t.sent.find((s) => s.type === MSG_TYPES.TASK_RESULT);
  const agentKey = await deriveSessionKey(agent.privateKey, phone.publicKey, salt);
  const dec = res && res.payload.result_cipher ? await decrypt(agentKey, res.payload.result_cipher, aad) : null;
  const decText = dec ? new TextDecoder().decode(dec) : '';
  check('结果被加密且手机可解', !!dec && decText.includes('执行:删除临时文件'), decText);
}

// ---- 测试3：high 风险 + confirmPolicy=high → confirm.request，allow 后执行 ----
{
  const t = mockTransport(); const ex = mockExecutor();
  const svc = createCloudService({ transport: t, executor: ex, confirmPolicy: 'high', config: {}, log: { info(){}, warn(){}, error(){} } });
  t.recv({ v: 1, type: MSG_TYPES.TASK_SUBMIT, msgId: 'm3', seq: 3, payload: { taskId: 'tsk_3', prompt: 'rm -rf 删除全部', requireConfirm: true } });
  await new Promise((r) => setTimeout(r, 10));
  const cf = t.sent.find((s) => s.type === MSG_TYPES.CONFIRM_REQUEST);
  check('high 风险触发 confirm.request', !!cf && cf.payload.taskId === 'tsk_3');
  check('confirm 阶段未执行 executor', ex.calls.length === 0);
  t.recv({ v: 1, type: MSG_TYPES.CONFIRM_RESPONSE, msgId: 'cm', seq: 4, payload: { requestId: cf.payload.requestId, decision: 'allow' } });
  await new Promise((r) => setTimeout(r, 20));
  check('allow 后执行 executor', ex.calls.length === 1);
}

// ---- 测试4：confirm deny → 不执行，回失败 ----
{
  const t = mockTransport(); const ex = mockExecutor();
  const svc = createCloudService({ transport: t, executor: ex, confirmPolicy: 'high', config: {}, log: { info(){}, warn(){}, error(){} } });
  t.recv({ v: 1, type: MSG_TYPES.TASK_SUBMIT, msgId: 'm4', seq: 5, payload: { taskId: 'tsk_4', prompt: 'rm -rf x', requireConfirm: true } });
  await new Promise((r) => setTimeout(r, 10));
  const cf = t.sent.find((s) => s.type === MSG_TYPES.CONFIRM_REQUEST);
  t.recv({ v: 1, type: MSG_TYPES.CONFIRM_RESPONSE, msgId: 'cm2', seq: 6, payload: { requestId: cf.payload.requestId, decision: 'deny' } });
  await new Promise((r) => setTimeout(r, 20));
  const res = t.sent.find((s) => s.type === MSG_TYPES.TASK_RESULT);
  check('拒绝后未执行 executor', ex.calls.length === 0);
  check('拒绝回失败状态', res && (res.payload.cancelled === true || res.payload.ok === false));
}

console.log('\n===== 汇总 =====');
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} 通过`);
if (passed < results.length) {
  results.filter((r) => !r.ok).forEach((r) => console.log('  -', r.name, r.detail));
  process.exit(1);
}
