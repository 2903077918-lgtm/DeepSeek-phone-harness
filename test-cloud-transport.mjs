// test-cloud-transport.mjs —— Agent 云端传输层（cloud.mjs）协议状态机单测
// 用 mock socket 模拟云端，不连真实网络，验证：
//   hello 握手信封 / 心跳 ping+pong / 断线退避重连 / task.ack 回执出队 / 消息分发 / disconnect 清理
// 用法：node test-cloud-transport.mjs
import {
  createCloudTransport,
  HEARTBEAT_MISS_LIMIT,
} from './src/transport/cloud.mjs';
import { MSG_TYPES } from './src/protocol.js';

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log((cond ? '✅' : '❌'), name, detail ? '| ' + detail : '');
}

// ---- 可手动驱动的 mock socket ----
function createMockSocket() {
  const s = {
    sent: [],
    _ready: false,
    open() { s._ready = true; if (s.onopen) s.onopen(); },
    close() { if (s.onclose) setTimeout(() => s.onclose(), 0); },
    recv(obj) { if (s.onmessage) s.onmessage({ data: JSON.stringify(obj) }); },
    send(t) { s.sent.push(JSON.parse(t)); },
  };
  return s;
}
// 接收一个 socket 上第 n 条 type=hello 的信封
function lastOfType(socket, type) {
  for (let i = socket.sent.length - 1; i >= 0; i--) {
    if (socket.sent[i].type === type) return socket.sent[i];
  }
  return null;
}

// ---- 测试1：connect 后发 agent.hello，信封字段正确 ----
{
  const sock = createMockSocket();
  let made = 0;
  const t = createCloudTransport({
    url: 'wss://relay.example.com/v1/agent/ws', deviceId: 'dev_abc', deviceToken: 'tok_1',
    version: '0.3.0', capabilities: ['headless', 'web'], resumeToken: 'resume_1',
    pendingTasks: ['tsk_pending'],
    socketFactory: () => { made++; return sock; },
    heartbeatMs: 99999, // 单测不触发心跳
    setTimer: (fn) => { return 0; }, // 这里不真正调度（后续用真实定时器测心跳时另建实例）
  });
  t.connect();
  sock.open();
  const hello = lastOfType(sock, MSG_TYPES.HELLO);
  check('发 agent.hello', !!hello);
  check('hello 信封字段', hello.deviceId === 'dev_abc' && hello.v === 1 && typeof hello.msgId === 'string' && hello.seq >= 0);
  check('hello payload 能力/续传', hello.payload.capabilities[0] === 'headless' && hello.payload.resumeToken === 'resume_1' && hello.payload.pendingTasks[0] === 'tsk_pending');
  check('connect 状态 open', t.state === 'open');
  t.disconnect();
}

// ---- 测试2：心跳：到点发 control.ping；收到 pong 重置 ----
{
  const sock = createMockSocket();
  const t = createCloudTransport({
    url: 'wss://x/v1/agent/ws', deviceId: 'dev', deviceToken: 'tok',
    socketFactory: () => sock,
    heartbeatMs: 100,          // 100ms 发一次 ping
    reconnectBaseMs: 4, reconnectMaxMs: 8,
  });
  t.connect();
  sock.open();
  const pingsBefore = sock.sent.filter((m) => m.type === MSG_TYPES.PING).length;
  await new Promise((r) => setTimeout(r, 220)); // 覆盖 2 个心跳周期；未达 miss-limit=3，仍 open
  const pingsAfter = sock.sent.filter((m) => m.type === MSG_TYPES.PING).length;
  check('心跳到点发 control.ping', pingsAfter > pingsBefore, `ping 数 ${pingsBefore}→${pingsAfter}`);
  // 收到 pong → miss 重置（不判定断线）
  sock.recv({ v: 1, type: MSG_TYPES.PONG, msgId: 'g1', seq: 1 });
  await new Promise((r) => setTimeout(r, 40));
  check('收 pong 后连接保持 open', t.state === 'open');
  t.disconnect();
}

// ---- 测试3：断线 → 退避重连 → 重新发 hello（新 socket）----
{
  let sockets = [];
  const t = createCloudTransport({
    url: 'wss://x/v1/agent/ws', deviceId: 'dev', deviceToken: 'tok', resumeToken: 'r1',
    socketFactory: () => { const s = createMockSocket(); sockets.push(s); return s; },
    heartbeatMs: 99999, reconnectBaseMs: 0, reconnectMaxMs: 0,
    setTimer: (fn) => { setTimeout(fn, 1); return 0; }, // 立即执行重连
  });
  t.connect();
  sockets[0].open();
  const n0 = sockets.length;
  sockets[0].close(); // 触发 onclose → 重连
  await new Promise((r) => setTimeout(r, 20));
  check('断线触发重连(新socket)', sockets.length === 2);
  sockets[1].open();
  const hello2 = lastOfType(sockets[sockets.length - 1], MSG_TYPES.HELLO);
  check('重连重发 hello', !!hello2);
  t.disconnect();
}

// ---- 测试4：task.ack 回执出队 ----
{
  const sock = createMockSocket();
  const t = createCloudTransport({
    url: 'wss://x/v1/agent/ws', deviceId: 'dev', deviceToken: 'tok',
    socketFactory: () => sock, heartbeatMs: 99999, setTimer: () => 0,
  });
  t.connect();
  sock.open();
  const env = t.sendResult('tsk_1', { ok: true, stdout: 'ok' });
  check('sendResult 入 outbox', t.outboxSize === 1 && !!env.msgId);
  // 云端回 ack
  sock.recv({ v: 1, type: MSG_TYPES.TASK_ACK, msgId: 'ack1', seq: 2, payload: { msgId: env.msgId } });
  await new Promise((r) => setTimeout(r, 10));
  check('ack 后出队', t.outboxSize === 0);
  t.disconnect();
}

// ---- 测试5：消息分发（task.submit → onMessage）----
{
  const sock = createMockSocket();
  const seen = [];
  const t = createCloudTransport({
    url: 'wss://x/v1/agent/ws', deviceId: 'dev', deviceToken: 'tok',
    socketFactory: () => sock, heartbeatMs: 99999, setTimer: () => 0,
  });
  t.on('message', (env) => seen.push(env.type));
  t.connect();
  sock.open();
  sock.recv({ v: 1, type: MSG_TYPES.TASK_SUBMIT, msgId: 'm1', seq: 5, payload: { taskId: 'tsk' } });
  check('task.submit 分发到 onMessage', seen.includes(MSG_TYPES.TASK_SUBMIT));
  // 坏帧忽略
  sock.recv('not json');
  t.disconnect();
}

// ---- 测试6：disconnect 清理（状态 closed，无残留 socket）----
{
  const sock = createMockSocket();
  const t = createCloudTransport({
    url: 'wss://x/v1/agent/ws', deviceId: 'dev', deviceToken: 'tok',
    socketFactory: () => sock, heartbeatMs: 99999, setTimer: () => 0,
  });
  t.connect();
  sock.open();
  t.disconnect();
  check('disconnect 状态 closed', t.state === 'closed');
}

console.log('\n===== 汇总 =====');
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} 通过`);
if (passed < results.length) {
  results.filter((r) => !r.ok).forEach((r) => console.log('  -', r.name, r.detail));
  process.exit(1);
}
