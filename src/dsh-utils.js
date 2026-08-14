// src/dsh-utils.js —— DSH 公共工具函数集（DSH Web API RPC + 事件归一化 + 路径工具）
// 从 executor.js 拆分而来，供执行器 / 审批中继 / 传输层复用。
// 本模块不持有状态，全部为纯函数与无状态工具。

export const WEB_API_BASE = 'http://127.0.0.1:3080';

export function cryptoRandom() {
  return 'rpc-' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- DSH Web API RPC 封装（127.0.0.1:3080）----
// 请求信封：{type:'client-request', rpcId, method, payload}；响应取 result.value。
export async function fetchRpc(method, payload) {
  const resp = await fetch(WEB_API_BASE + '/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: cryptoRandom(), method, payload }),
  });
  if (!resp.ok) throw new Error(method + ' HTTP ' + resp.status);
  const json = await resp.json();
  if (!json.result?.ok) throw new Error(method + ' failed: ' + JSON.stringify(json.result?.error || {}).slice(0, 200));
  return json.result.value;
}

// ---- DSH 事件 / 时间工具（探测结论见 executor.js 原有注释）----
export function isoTime(t) {
  const n = Number(t);
  return new Date(Number.isFinite(n) && n > 0 ? n : Date.now()).toISOString();
}

// 会话事件 → 流式条目（/api/events 增量用）
// 提取规则：assistant/chunk 增量文本（text-delta / reasoning-delta / tool-call-delta / block-start）；
//   assistant/message 与 user/message 的 content[].text；tool/call 的 name；
//   其余事件保留 type 但无 text（前端可据此感知 turn/end 等状态）。
export function eventToStreamItem(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const type = ev.type;
  const data = ev.data || {};
  let text;
  let subtype = null;
  let kind = 'other'; // 标准化类型：text(可见文本) | thinking(推理) | tool(工具) | done(完成) | other
  if (type === 'assistant/chunk') {
    const chunk = data.chunk;
    if (chunk && typeof chunk === 'object') {
      const ctype = chunk.type;
      if (ctype === 'text-delta' && typeof chunk.text === 'string') {
        text = chunk.text; subtype = 'text'; kind = 'text';
      } else if (ctype === 'reasoning-delta' && typeof chunk.text === 'string') {
        text = chunk.text; subtype = 'reasoning'; kind = 'thinking';
      } else if (ctype === 'tool-call-delta' && typeof chunk.name === 'string') {
        text = chunk.name; subtype = 'tool'; kind = 'tool';
      } else if (ctype === 'block-start') {
        subtype = 'block-start'; text = ''; kind = 'other';
      }
    }
  } else if (type === 'assistant/message' || type === 'user/message') {
    const content = type === 'assistant/message' ? (data.message && data.message.content) : data.content;
    if (Array.isArray(content)) {
      const t = content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('');
      if (t) { text = t; kind = 'text'; }
    }
  } else if (type === 'tool/call') {
    if (data.name) { text = String(data.name); kind = 'tool'; }
  } else if (type === 'turn/end') {
    kind = 'done';
  }
  const item = { seq: Number(ev.seq) || 0, type, kind, time: isoTime(ev.time) };
  if (text !== undefined) item.text = text;
  if (subtype) item.subtype = subtype;
  return item;
}

// session.history events → 对话消息数组（/api/dsh-history 用）
export function historyToMessages(events) {
  const items = [];
  for (const ev of events || []) {
    const e = ev && ev.event;
    if (!e) continue;
    const data = e.data || {};
    if (e.type === 'user/message' && Array.isArray(data.content)) {
      const text = data.content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('');
      if (text) items.push({ role: 'user', text, time: isoTime(e.time) });
    } else if (e.type === 'assistant/message') {
      const content = data.message && data.message.content;
      if (Array.isArray(content)) {
        const text = content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('');
        if (text) items.push({ role: 'assistant', text, time: isoTime(e.time) });
      }
    } else if (e.type === 'tool/call' && data.name) {
      items.push({ role: 'tool', text: String(data.name), time: isoTime(e.time) });
    }
  }
  return items;
}

// 归一化路径（Windows 反斜杠 → 正斜杠小写），供 cwd 前缀分组
export function normPath(p) {
  return String(p || '').replace(/\\/g, '/').toLowerCase();
}

// 取路径最后一段（basename）；空路径返回 '未命名'
// 注：此函数原在 executor.js 中被调用但缺失定义（潜伏 ReferenceError），拆分时补全。
export function baseName(p) {
  const s = String(p || '').replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : (s || '未命名');
}
