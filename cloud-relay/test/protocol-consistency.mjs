// cloud-relay/test/protocol-consistency.mjs —— 云端 protocol.ts 与 Agent protocol.js 一致性
// 验证云端/Agent 协议未漂移：对同一输入信封，两者 createEnvelope / validateEnvelope 行为一致。
// 用法：node test/protocol-consistency.mjs
import assert from 'node:assert';
import * as agent from '../../src/protocol.js';      // phone-harness/src/protocol.js（Agent）
import * as cloud from '../src/protocol.ts';          // cloud-relay/src/protocol.ts（云端）

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('✅', name); }
  catch (e) { console.log('❌', name, '|', e.message); process.exitCode = 1; }
}

// 1. MSG_TYPES 键集合完全一致
check('MSG_TYPES 键一致', () => {
  const ak = Object.keys(agent.MSG_TYPES).sort();
  const ck = Object.keys(cloud.MSG_TYPES).sort();
  assert.deepStrictEqual(ck, ak, `diff ${JSON.stringify(ck)} vs ${JSON.stringify(ak)}`);
});

// 2. createEnvelope 对相同入参产出一致信封字段
check('createEnvelope 一致', () => {
  const a = agent.createEnvelope(agent.MSG_TYPES.TASK_SUBMIT, { deviceId: 'dev_1', seq: 3 }, { taskId: 't1' });
  const c = cloud.createEnvelope(cloud.MSG_TYPES.TASK_SUBMIT, { deviceId: 'dev_1', seq: 3 }, { taskId: 't1' });
  assert.strictEqual(a.v, c.v, 'v');
  assert.strictEqual(a.type, c.type, 'type');
  assert.strictEqual(a.deviceId, c.deviceId, 'deviceId');
  assert.strictEqual(a.seq, c.seq, 'seq');
  assert.deepStrictEqual(a.payload, c.payload, 'payload');
});

// 3. 互相 validate：Agent 产出的信封对云端 validateEnvelope 通过，反之亦然
check('跨侧 validate 通过', () => {
  const a = agent.createEnvelope(agent.MSG_TYPES.HELLO, { seq: 5 }, { agentId: 'x' });
  const c = cloud.createEnvelope(cloud.MSG_TYPES.HELLO, { seq: 5 }, { agentId: 'x' });
  assert.ok(cloud.validateEnvelope(a), 'Agent→cloud ok');
  assert.ok(agent.validateEnvelope(c), 'cloud→agent ok');
});

// 4. 坏帧行为一致
check('坏帧/非法一致', () => {
  assert.strictEqual(cloud.parseEnvelope('not json'), null);
  assert.strictEqual(agent.parseEnvelope('not json'), null);
  assert.strictEqual(cloud.validateEnvelope({ v: 9, type: 'x', msgId: 'm' }), false, 'v 版本不一致');
});

console.log(`\n${passed} 项通过（Agent protocol.js ⇄ cloud protocol.ts 一致）`);
