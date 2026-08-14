// src/transport-lan.js —— 局域网 HTTP 传输层（8788）
// 行为与 v0.2.0 兼容：Bearer token、/api/status|exec|history、首页加载 web/index.html；
// v0.3.0 新增 /api/sessions（GET 列表 / POST 新建）、/api/exec 支持可选 sessionId、/api/history 支持 sessionId 过滤
// v0.4.0 新增 /api/approvals（GET 待审批列表 / POST 回传结果）：转发 DSH 审批请求（WebSocket 监听 + /api/respond）
// v0.5.0 新增 DSH 同步/流式 API：
//   GET  /api/dsh-workspaces    —— 转发 workspace.list + 按 cwd 前缀分组 → {ok, items:[{workspaceId,path,title,sessionCount}]}
//   GET  /api/dsh-sessions      —— 转发 session.list（title 取自 projections）→ {ok, items:[{sessionId,cwd,title?,updatedAt,running,blank}]}
//   POST /api/dsh-continue      —— {sessionId, task} 对 DSH 已有会话继续发消息（队列串行，不新建）→ {ok, sessionId, result}
//   GET  /api/dsh-history?sessionId=[&limit=N] —— 转发 session.history → {ok, items:[{role:'user'|'assistant'|'tool',text,time}]}
//   GET  /api/events?sessionId=&afterSeq=N    —— 流式增量轮询 → {ok, items:[{seq,type,text?,subtype?,time}], lastSeq}
//   （事件缓冲由 executor 的 relay 扩展：同一 events.mux WS 连接同时收集 session/event 帧，每会话保留最近 200 条）
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PORT, HOST, AGENT_VERSION } from './config.js';
import { createApprovalRelay } from './executor.js';

export function createLanTransport({ config, rootDir, executor, history, queue }) {
  function auth(req, res) {
    const h = req.headers.authorization || '';
    if (h !== `Bearer ${config.token}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
      return false;
    }
    return true;
  }
  function sendJson(res, code, obj) {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  }
  function readBody(req) {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    });
  }

  // DSH 审批转发中继：优先复用 executor 附加的 relay（懒创建，首次访问即启动常驻 WebSocket 连接
  // 到 ws://127.0.0.1:3080/api/events.mux）；executor 无 relay（如 mock）时在此自行创建。
  // 均不依赖鉴权头，失败静默退避重试。
  const relay = executor?.relay || createApprovalRelay();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        // no-store：防止手机浏览器缓存旧版 UI（v2 升级后旧缓存导致"无法加载"）
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, no-cache, must-revalidate' });
        const webFile = path.join(rootDir, 'web', 'index.html');
        if (existsSync(webFile)) {
          res.end(readFileSync(webFile, 'utf8'));
        } else {
          res.end('<!DOCTYPE html><html><body><h1>deepseekharness-relay</h1><p>web/index.html 缺失</p></body></html>');
        }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        if (!auth(req, res)) return;
        sendJson(res, 200, { ok: true, agent: 'deepseekharness-relay', version: AGENT_VERSION, time: new Date().toISOString(), pending: queue.size });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/history') {
        if (!auth(req, res)) return;
        // 可选 sessionId 过滤：GET /api/history?sessionId=xxx 只返回该会话的任务记录（无过滤时返回全部）
        const sessionId = (url.searchParams.get('sessionId') || '').trim() || undefined;
        const all = history.list();
        const items = sessionId ? all.filter((e) => e.sessionId === sessionId) : all;
        sendJson(res, 200, { ok: true, items });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/sessions') {
        if (!auth(req, res)) return;
        const items = typeof executor.listSessions === 'function' ? executor.listSessions() : [];
        sendJson(res, 200, { ok: true, items });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/exec') {
        if (!auth(req, res)) return;
        const body = await readBody(req);
        const task = String(body.task || '').trim();
        if (!task) { sendJson(res, 400, { ok: false, error: 'task 不能为空' }); return; }
        // 可选 sessionId：传入则复用该会话（保持上下文），否则走默认逻辑（both 模式复用最近会话）
        const sessionId = body.sessionId ? String(body.sessionId).trim() : undefined;
        const runOpts = sessionId ? { sessionId } : {};
        await queue.enqueue(async () => {
          const result = await executor.run(task, runOpts);
          // result 里带 sessionId（webapi 后端）时随 spread 一并入库，供 /api/history?sessionId= 过滤；
          // headless 结果无 sessionId，条目不带该字段（符合要求 3）
          history.append({ id: crypto.randomUUID(), task, ...result, at: new Date().toISOString() });
          return result;
        }).then((result) => {
          // sessionId 为 undefined 时 JSON.stringify 自动省略该字段，向后兼容旧客户端
          sendJson(res, 200, { ok: true, sessionId: result.sessionId, result });
        }).catch((e) => {
          sendJson(res, 500, { ok: false, error: String(e) });
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/sessions') {
        if (!auth(req, res)) return;
        try {
          const sess = typeof executor.createSession === 'function'
            ? await executor.createSession()
            : await executor.ensureSession();
          sendJson(res, 200, { ok: true, sessionId: sess.sessionId });
        } catch (e) {
          sendJson(res, 500, { ok: false, error: '新建会话失败（Web API 后端不可用?）: ' + String(e) });
        }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/approvals') {
        if (!auth(req, res)) return;
        // 待审批列表（最新在前）；只暴露手机端需要的字段，rpcId 为内部实现细节不外泄
        const items = relay.listPending().map((r) => ({
          approvalId: r.approvalId,
          sessionId: r.sessionId,
          toolName: r.toolName,
          callId: r.callId,
          reason: r.reason,
          receivedAt: r.receivedAt,
        }));
        sendJson(res, 200, { ok: true, items });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/approvals') {
        if (!auth(req, res)) return;
        const body = await readBody(req);
        const approvalId = String(body.approvalId || '').trim();
        const outcome = String(body.outcome || '').trim();
        if (!approvalId) { sendJson(res, 400, { ok: false, accepted: false, error: 'approvalId 不能为空' }); return; }
        if (outcome !== 'allowed-once' && outcome !== 'rejected') {
          sendJson(res, 400, { ok: false, accepted: false, error: 'outcome 只允许 allowed-once / rejected' });
          return;
        }
        const result = await relay.respond({ approvalId, outcome });
        if (!result.ok) {
          sendJson(res, 404, { ok: false, accepted: false, error: result.error });
          return;
        }
        sendJson(res, 200, { ok: true, accepted: true });
        return;
      }
      // ---- DSH 项目/会话同步（只读转发，供手机端浏览电脑上的项目与会话）----
      if (req.method === 'GET' && url.pathname === '/api/dsh-workspaces') {
        if (!auth(req, res)) return;
        if (typeof executor.listDshWorkspaces !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        try {
          const items = await executor.listDshWorkspaces();
          sendJson(res, 200, { ok: true, items });
        } catch (e) {
          sendJson(res, 502, { ok: false, error: 'DSH 同步失败（Web API 后端不可用?）: ' + String(e) });
        }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/dsh-sessions') {
        if (!auth(req, res)) return;
        if (typeof executor.listDshSessions !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        try {
          const withCount = (url.searchParams.get('withCount') || '').toLowerCase() === 'true';
          const items = await executor.listDshSessions(withCount);
          sendJson(res, 200, { ok: true, items });
        } catch (e) {
          sendJson(res, 502, { ok: false, error: 'DSH 同步失败（Web API 后端不可用?）: ' + String(e) });
        }
        return;
      }
      // ---- 继续电脑会话 + 读会话历史 ----
      if (req.method === 'POST' && url.pathname === '/api/dsh-continue') {
        if (!auth(req, res)) return;
        const body = await readBody(req);
        const sessionId = String(body.sessionId || '').trim();
        const task = String(body.task || '').trim();
        if (!sessionId) { sendJson(res, 400, { ok: false, error: 'sessionId 不能为空' }); return; }
        if (!task) { sendJson(res, 400, { ok: false, error: 'task 不能为空' }); return; }
        if (typeof executor.continueSession !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        // 与 /api/exec 共用队列：同一时间只跑一个任务（DSH 会话单写）
        await queue.enqueue(async () => executor.continueSession({ sessionId, task }))
          .then((out) => {
            if (!out.ok) {
              const code = out.code === 'session-not-found' ? 404 : (out.code === 'bad-request' ? 400 : 502);
              sendJson(res, code, { ok: false, error: out.error });
              return;
            }
            sendJson(res, 200, { ok: true, sessionId: out.sessionId, result: out.result });
          })
          .catch((e) => {
            sendJson(res, 500, { ok: false, error: String(e) });
          });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/dsh-history') {
        if (!auth(req, res)) return;
        const sessionId = (url.searchParams.get('sessionId') || '').trim();
        if (!sessionId) { sendJson(res, 400, { ok: false, error: 'sessionId 不能为空' }); return; }
        if (typeof executor.getDshHistory !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        try {
          const limit = Number(url.searchParams.get('limit') || '');
          const items = await executor.getDshHistory(sessionId, Number.isFinite(limit) ? limit : undefined);
          sendJson(res, 200, { ok: true, items });
        } catch (e) {
          sendJson(res, 502, { ok: false, error: 'DSH 历史读取失败: ' + String(e) });
        }
        return;
      }
      // ---- 流式增量轮询（打字机数据源：缓冲来自 events.mux 的 session/event 帧）----
      if (req.method === 'GET' && url.pathname === '/api/events') {
        if (!auth(req, res)) return;
        const sessionId = (url.searchParams.get('sessionId') || '').trim();
        if (!sessionId) { sendJson(res, 400, { ok: false, error: 'sessionId 不能为空' }); return; }
        const afterSeq = Number(url.searchParams.get('afterSeq') || '0');
        const out = await executor.getEvents(sessionId, Number.isFinite(afterSeq) ? afterSeq : 0);
        sendJson(res, 200, { ok: true, ...out });
        return;
      }
      // ---- 中断正在运行的会话任务（转发 DSH session.cancel）----
      if (req.method === 'POST' && url.pathname === '/api/cancel') {
        if (!auth(req, res)) return;
        if (typeof executor.cancelSession !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        const body = await readBody(req);
        const out = await executor.cancelSession(body.sessionId);
        sendJson(res, out.ok ? 200 : 400, out);
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e) });
    }
  });

  function start() {
    server.listen(PORT, HOST, () => {
      console.log('==============================================');
      console.log(' deepseekharness-relay Agent v' + AGENT_VERSION);
      console.log('----------------------------------------------');
      console.log(' 控制台: http://<本机局域网IP>:' + PORT);
      console.log(' 本机:   http://127.0.0.1:' + PORT);
      console.log(' Token:  ' + config.token);
      console.log('----------------------------------------------');
      console.log(' 手机使用: 同一 WiFi 下访问 http://<电脑IP>:' + PORT);
      console.log(' 安全: 仅限局域网；请勿将本端口暴露到公网。');
      console.log('==============================================');
    });
    return server;
  }
  return { start, server, relay };
}
