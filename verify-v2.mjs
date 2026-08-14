// 集成验证：UI + 后端新字段
import { readFileSync } from 'node:fs';
const token = JSON.parse(readFileSync('C:/Users/Joey/Documents/phone-harness/config.json', 'utf8')).token;
const h = { 'content-type': 'application/json', authorization: 'Bearer ' + token };

const page = await (await fetch('http://127.0.0.1:8788/', { headers: { authorization: 'Bearer ' + token } })).text();
console.log('1. UI:', page.length, 'B | kind适配:', page.includes('handleEventItem') || page.includes("kind"));

const s = await (await fetch('http://127.0.0.1:8788/api/dsh-sessions?withCount=true', { headers: h })).json();
const sample = (s.items || []).find(i => i.messageCount != null && i.ungrouped !== undefined);
console.log('2. dsh-sessions:', s.items?.length, '| 样本:', JSON.stringify({ mc: sample?.messageCount, ug: sample?.ungrouped }));

const ev = await (await fetch('http://127.0.0.1:8788/api/events?sessionId=' + (s.items?.[0]?.sessionId || '') + '&afterSeq=0', { headers: h })).json();
const kinds = {};
(ev.items || []).forEach(i => { kinds[i.kind] = (kinds[i.kind] || 0) + 1; });
console.log('3. events kind:', JSON.stringify(kinds));

const c = await (await fetch('http://127.0.0.1:8788/api/cancel', { method: 'POST', headers: h, body: JSON.stringify({ sessionId: 'x' }) })).json();
console.log('4. cancel 链路:', c.ok === false && c.error ? '正常转发' : JSON.stringify(c).slice(0, 60));
