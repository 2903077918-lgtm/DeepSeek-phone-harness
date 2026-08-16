// End-to-end test: simulate phone -> agent -> dsh headless -> result
import { readFileSync } from 'node:fs';
import { agentReady } from './test-utils/agent-ready.mjs';
await agentReady();

const token = JSON.parse(readFileSync('C:/Users/Joey/Documents/phone-harness/config.json', 'utf8')).token;
const base = 'http://127.0.0.1:8788';
const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + token };

// 1. status
const status = await (await fetch(base + '/api/status', { headers })).json();
console.log('1. /api/status:', JSON.stringify(status));

// 2. exec a real task
console.log('\n2. /api/exec 发送任务...');
const t0 = Date.now();
const execResp = await (await fetch(base + '/api/exec', {
  method: 'POST', headers, body: JSON.stringify({ task: '帮我查一下当前电脑的磁盘剩余空间，用一条简短中文回复' }),
})).json();
console.log('   耗时:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('   exec.ok:', execResp.ok);
const r = execResp.result || {};
console.log('   exitCode:', r.exitCode);
console.log('   stdout:', (r.stdout || '').slice(0, 300));

// 3. history
const hist = await (await fetch(base + '/api/history', { headers })).json();
console.log('\n3. /api/history items:', hist.items?.length);
if (hist.items?.[0]) console.log('   最新任务:', hist.items[0].task.slice(0, 50), '| ok:', hist.items[0].ok);
