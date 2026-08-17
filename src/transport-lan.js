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
import os from 'node:os';
import { spawn } from 'node:child_process';
import { PORT, HOST, AGENT_VERSION } from './config.js';
import { createApprovalRelay } from './approval-relay.js';

// ---- 图片 OCR（Windows 自带 OCR：免费、本地、不耗 token；输出逐行文本供前端组装 markdown）----
function runOcr(scriptPath, imagePath) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, imagePath], {
      windowsHide: true,
      env: { ...process.env },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      const text = stdout.trim();
      if (code !== 0 || !text || text.startsWith('ERR_')) {
        resolve({ ok: false, error: (stderr || text || 'OCR 无输出').slice(0, 300) });
      } else {
        resolve({ ok: true, text });
      }
    });
    child.on('error', (e) => resolve({ ok: false, error: String(e) }));
  });
}

// ---- 终端命令执行器（/api/shell 用，codex-relay workspace-ssh-terminal 的手机版）----
// 每个命令独立进程（cmd + chcp 65001 输出 UTF-8），输出按序缓存，UI 增量轮询；
// 无 PTY 交互能力（Windows 无内置），长任务可停止（taskkill /T /F）。
const shellJobs = new Map(); // jobId -> job
let shellJobSeq = 0;
const SHELL_MAX_OUTPUT = 300000; // 单任务输出上限 300KB
const SHELL_MAX_JOBS = 50;       // 任务表上限（FIFO 淘汰）

function runShellCommand({ cwd, command }) {
  const cmd = String(command || '').trim();
  const job = {
    id: 'sh-' + (++shellJobSeq) + '-' + Date.now().toString(36),
    cwd: cwd ? path.resolve(String(cwd)) : process.cwd(),
    command: cmd,
    output: [],        // [{t:'out'|'err', s}]
    running: true,
    exitCode: null,
    truncated: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    child: null,
  };
  if (!cmd) { job.running = false; job.exitCode = -1; job.finishedAt = new Date().toISOString(); job.output.push({ t: 'err', s: '命令不能为空' }); shellJobs.set(job.id, job); return job; }
  shellJobs.set(job.id, job);
  if (shellJobs.size > SHELL_MAX_JOBS) {
    const oldest = shellJobs.keys().next().value;
    if (oldest !== undefined) shellJobs.delete(oldest);
  }
  const push = (t, buf) => {
    if (job.truncated) return;
    let s = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
    const total = job.output.reduce((n, o) => n + o.s.length, 0);
    if (total + s.length > SHELL_MAX_OUTPUT) {
      s = s.slice(0, Math.max(0, SHELL_MAX_OUTPUT - total));
      job.truncated = true;
    }
    if (s) job.output.push({ t, s });
  };
  try {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', 'chcp 65001 >nul & ' + cmd], {
      cwd: job.cwd,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', LANG: 'en_US.UTF-8' },
    });
    job.child = child;
    child.stdout.on('data', (d) => push('out', d));
    child.stderr.on('data', (d) => push('err', d));
    child.on('error', (e) => { push('err', '进程启动失败: ' + String(e)); job.running = false; job.exitCode = -1; job.finishedAt = new Date().toISOString(); });
    child.on('close', (code) => { job.running = false; job.exitCode = code; job.finishedAt = new Date().toISOString(); });
  } catch (e) {
    job.running = false; job.exitCode = -1; job.finishedAt = new Date().toISOString();
    job.output.push({ t: 'err', s: '启动失败: ' + String(e) });
  }
  return job;
}

function stopShellJob(jobId) {
  const job = shellJobs.get(String(jobId || ''));
  if (!job) return { ok: false, error: '任务不存在' };
  if (!job.running) return { ok: true, alreadyStopped: true };
  if (job.child && job.child.pid) {
    try { spawn('taskkill', ['/PID', String(job.child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* ignore */ }
  }
  return { ok: true };
}

export function createLanTransport({ config, rootDir, executor, history, queue, push }) {
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
    res.writeHead(code, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type, authorization, x-user-id',
      'access-control-max-age': '86400',
    });
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
      // CORS 预检
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'content-type, authorization, x-user-id',
          'access-control-max-age': '86400',
        });
        res.end();
        return;
      }
      // 根路径直接给手机新界面（relay.html，codex-relay 风格）；旧控制台保留在 /console
      if (req.method === 'GET' && url.pathname === '/') {
        // no-store：防止手机浏览器缓存旧版 UI（旧缓存导致"看不到新界面"）
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, no-cache, must-revalidate' });
        const relayFile = path.join(rootDir, 'web', 'relay.html');
        if (existsSync(relayFile)) {
          res.end(readFileSync(relayFile, 'utf8'));
        } else {
          res.end('<!DOCTYPE html><html><body><h1>relay.html 缺失</h1></body></html>');
        }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/console') {
        // 旧局域网控制台（v2 界面，已归档到 console.html），仅保留入口不主动展示
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, no-cache, must-revalidate' });
        const consoleFile = path.join(rootDir, 'web', 'console.html');
        if (existsSync(consoleFile)) {
          res.end(readFileSync(consoleFile, 'utf8'));
        } else {
          res.end('<!DOCTYPE html><html><body><h1>deepseekharness-relay</h1><p>web/console.html 缺失</p></body></html>');
        }
        return;
      }
      // 独立手机界面（codex-relay 风格）
      if ((req.method === 'GET' && url.pathname === '/relay.html') || (req.method === 'GET' && url.pathname === '/mobile')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, no-cache, must-revalidate' });
        const relayFile = path.join(rootDir, 'web', 'relay.html');
        if (existsSync(relayFile)) {
          res.end(readFileSync(relayFile, 'utf8'));
        } else {
          res.end('<!DOCTYPE html><html><body><h1>relay.html 缺失</h1></body></html>');
        }
        return;
      }
      // 推送 Service Worker（PWA Web Push）
      if (req.method === 'GET' && url.pathname === '/sw.js') {
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
        const swFile = path.join(rootDir, 'web', 'sw.js');
        res.end(existsSync(swFile) ? readFileSync(swFile, 'utf8') : '/* sw.js 缺失 */');
        return;
      }
      // 品牌鲸鱼 logo（连接页/空态欢迎页）
      if (req.method === 'GET' && url.pathname === '/whale-logo.png') {
        const imgFile = path.join(rootDir, 'web', 'whale-logo.png');
        if (existsSync(imgFile)) {
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
          res.end(readFileSync(imgFile));
        } else {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('whale-logo.png 缺失');
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
          const body = await readBody(req);
          const agentPreset = String(body && body.agentPreset || '').trim() || undefined;
          const sess = typeof executor.createSession === 'function'
            ? await executor.createSession(agentPreset)
            : await executor.ensureSession();
          sendJson(res, 200, { ok: true, sessionId: sess.sessionId, agentPreset: agentPreset });
        } catch (e) {
          sendJson(res, 500, { ok: false, error: '新建会话失败（Web API 后端不可用?）: ' + String(e) });
        }
        return;
      }
      // ---- 命令中心：执行 DSH 斜杠命令（typert commands/execute）----
      // POST /api/dsh-command {sessionId, line} → executor.executeCommand
      if (req.method === 'POST' && url.pathname === '/api/dsh-command') {
        if (!auth(req, res)) return;
        if (typeof executor.executeCommand !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        const body = await readBody(req);
        const out = await executor.executeCommand(body.sessionId, body.line);
        sendJson(res, out.ok ? 200 : 400, out);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/approvals') {
        if (!auth(req, res)) return;
        // 待审批 + 待回答提问（最新在前）；rpcId 为内部实现细节不外泄，提问用 questionKey 标识
        const items = relay.listPending().map((r) => ({
          kind: r.kind || 'approval',
          approvalId: r.kind === 'approval' ? r.approvalId : undefined,
          questionKey: r.kind === 'question' ? r.questionKey : undefined,
          sessionId: r.sessionId,
          toolName: r.toolName,
          callId: r.callId,
          reason: r.reason,
          questions: r.kind === 'question' ? r.questions : undefined,
          receivedAt: r.receivedAt,
        }));
        sendJson(res, 200, { ok: true, items });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/approvals') {
        if (!auth(req, res)) return;
        const body = await readBody(req);
        const questionKey = String(body.questionKey || '').trim();
        if (questionKey) {
          // 回答 ask_user_question：{questionKey, answer:{answers:[{id,selected[],custom?}]}}
          const answer = body.answer;
          if (!answer || !Array.isArray(answer.answers) || !answer.answers.length) {
            sendJson(res, 400, { ok: false, accepted: false, error: 'answer 必须为 {answers:[{id,selected,...}]} 数组' });
            return;
          }
          const result = await relay.respond({ questionKey, answer });
          if (!result.ok) {
            sendJson(res, 404, { ok: false, accepted: false, error: result.error });
            return;
          }
          sendJson(res, 200, { ok: true, accepted: true });
          return;
        }
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
          const workspaceId = (url.searchParams.get('workspaceId') || '').trim() || undefined;
          const items = await executor.listDshSessions(workspaceId, withCount);
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
        const images = Array.isArray(body.images) ? body.images.slice(0, 4) : undefined; // 最多 4 张
        const interrupt = !!body.interrupt; // true → 先打断当前 turn 再插入新消息
        // 与 /api/exec 共用队列：同一时间只跑一个任务（DSH 会话单写）
        await queue.enqueue(async () => executor.continueSession({ sessionId, task, images, interrupt }))
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
          const limitRaw = url.searchParams.get('limit');
          const mmRaw = url.searchParams.get('maxMessages');
          const bsRaw = url.searchParams.get('beforeSeq');
          const limit = limitRaw === null ? NaN : Number(limitRaw);
          const maxMessages = mmRaw === null ? NaN : Number(mmRaw);
          const beforeSeq = bsRaw === null ? NaN : Number(bsRaw);
          const out = await executor.getDshHistory(sessionId, Number.isFinite(limit) ? limit : undefined, {
            maxMessages: Number.isInteger(maxMessages) && maxMessages > 0 ? maxMessages : undefined,
            beforeSeq: Number.isInteger(beforeSeq) && beforeSeq >= 0 ? beforeSeq : undefined,
          });
          sendJson(res, 200, { ok: true, items: out.items, firstSeq: out.firstSeq, hasMore: out.hasMore });
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
      // ---- 实时推送（SSE，对标 DSH events.mux 推送思路）：手机保持长连接，事件到达即推，替代 800ms 轮询 ----
      // GET /api/events.stream?sessionId=&afterSeq=  →  text/event-stream（data: 每事件一行 JSON；15s 心跳）
      if (req.method === 'GET' && url.pathname === '/api/events.stream') {
        if (!auth(req, res)) return;
        const sessionId = (url.searchParams.get('sessionId') || '').trim();
        if (!sessionId) { sendJson(res, 400, { ok: false, error: 'sessionId 不能为空' }); return; }
        const afterSeq = Number(url.searchParams.get('afterSeq') || '0');
        let after = Number.isFinite(afterSeq) && afterSeq > 0 ? afterSeq : 0;
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          'connection': 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.write('retry: 2000\n\n');
        let closed = false;
        req.on('close', () => { closed = true; });
        const heartbeat = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 15000);
        (async () => {
          try {
            while (!closed) {
              const out = await executor.getEvents(sessionId, after);
              if (out && out.items && out.items.length) {
                after = typeof out.lastSeq === 'number' ? out.lastSeq : after;
                for (const it of out.items) {
                  if (closed) break;
                  res.write('data: ' + JSON.stringify(it) + '\n\n');
                }
              }
              if (!closed) await new Promise((r) => setTimeout(r, 250));
            }
          } catch (e) {
            if (!closed) res.write('event: error\ndata: ' + JSON.stringify({ message: String(e) }) + '\n\n');
          } finally {
            clearInterval(heartbeat);
            if (!closed) res.end();
          }
        })();
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
      // ---- Agent 活动：转发 subagent.list → {ok, parentAvailable, items:[{sessionId,label,activity,kind,mode,hasChildren}]}
      if (req.method === 'GET' && url.pathname === '/api/agents') {
        if (!auth(req, res)) return;
        if (typeof executor.listAgents !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        const sessionId = (url.searchParams.get('sessionId') || '').trim();
        if (!sessionId) { sendJson(res, 400, { ok: false, error: 'sessionId 不能为空' }); return; }
        try {
          const out = await executor.listAgents(sessionId);
          if (!out.ok) {
            const code = out.code === 'backend-unavailable' ? 502 : 400;
            sendJson(res, code, { ok: false, error: out.error });
            return;
          }
          sendJson(res, 200, { ok: true, parentAvailable: out.parentAvailable, items: out.items });
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e) });
        }
        return;
      }
      // 文件读取（代码界面用）：GET /api/file?path= 返回文件内容 + 语言
      if (req.method === 'GET' && url.pathname === '/api/file') {
        if (!auth(req, res)) return;
        const fp = (url.searchParams.get('path') || '').trim();
        if (!fp) { sendJson(res, 400, { ok: false, error: 'missing path' }); return; }
        try {
          const full = path.resolve(rootDir, fp);
          const st = await import('node:fs/promises').then(m => m.stat(full));
          if (!st.isFile()) { sendJson(res, 400, { ok: false, error: 'not a file' }); return; }
          const content = await import('node:fs/promises').then(m => m.readFile(full, 'utf8'));
          sendJson(res, 200, { ok: true, path: fp, content, size: st.size });
        } catch (e) { sendJson(res, 500, { ok: false, error: String(e) }); }
        return;
      }
      // 列目录（代码界面用）：GET /api/files?path= 返回子项
      if (req.method === 'GET' && url.pathname === '/api/files') {
        if (!auth(req, res)) return;
        const dp = (url.searchParams.get('path') || '').trim();
        try {
          const full = path.resolve(rootDir, dp || '.');
          const { readdir } = await import('node:fs/promises');
          const entries = await readdir(full, { withFileTypes: true });
          const items = entries.map((e) => ({
            name: e.name, type: e.isDirectory() ? 'dir' : 'file',
            path: path.join(dp || '.', e.name).replace(/\\/g, '/'),
          })).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
          sendJson(res, 200, { ok: true, path: dp || '.', items });
        } catch (e) { sendJson(res, 500, { ok: false, error: String(e) }); }
        return;
      }
      // DSH 配置文件路径（设置页“打开配置文件”用）：GET /api/dsh-config
      if (req.method === 'GET' && url.pathname === '/api/dsh-config') {
        if (!auth(req, res)) return;
        const cfg = path.join(os.homedir(), '.dsh', 'settings.yaml');
        sendJson(res, 200, { ok: true, path: cfg.replace(/\\/g, '/') });
        return;
      }
      // ---- 图片 OCR → Markdown（Windows 自带 OCR：免费、本地、不耗 token）----
      // POST /api/ocr {imageBase64, ext?} → {ok, text}  文本按行返回，前端可整理为 markdown
      if (req.method === 'POST' && url.pathname === '/api/ocr') {
        if (!auth(req, res)) return;
        const body = await readBody(req);
        const b64 = String(body.imageBase64 || '').trim();
        if (!b64) { sendJson(res, 400, { ok: false, error: 'imageBase64 不能为空' }); return; }
        const tmpDir = path.join(os.tmpdir(), 'ph-ocr');
        try {
          await import('node:fs/promises').then((m) => m.mkdir(tmpDir, { recursive: true }));
          const fname = 'ocr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png';
          const fpath = path.join(tmpDir, fname);
          const buf = Buffer.from(b64, 'base64');
          if (!buf.length || buf.length > 15 * 1024 * 1024) { sendJson(res, 400, { ok: false, error: '图片数据无效或过大' }); return; }
          await import('node:fs/promises').then((m) => m.writeFile(fpath, buf));
          const script = path.join(rootDir, 'src', 'ocr.ps1');
          const out = await runOcr(script, fpath);
          await import('node:fs/promises').then((m) => m.unlink(fpath).catch(() => {}));
          if (!out.ok) { sendJson(res, 500, { ok: false, error: out.error }); return; }
          sendJson(res, 200, { ok: true, text: out.text });
        } catch (e) {
          sendJson(res, 500, { ok: false, error: 'OCR 失败: ' + String(e) });
        }
        return;
      }
      // POST /api/shell {cwd, command} → {ok, jobId}；GET /api/shell?jobId=&after=N → 增量输出
      // POST /api/shell/stop {jobId} → 终止进程树
      if (req.method === 'POST' && url.pathname === '/api/shell') {
        if (!auth(req, res)) return;
        const body = await readBody(req);
        const job = runShellCommand({ cwd: body.cwd, command: body.command });
        sendJson(res, 200, { ok: true, jobId: job.id, running: job.running, cwd: job.cwd, command: job.command });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/shell') {
        if (!auth(req, res)) return;
        const jobId = (url.searchParams.get('jobId') || '').trim();
        const after = Number(url.searchParams.get('after') || '0');
        const job = shellJobs.get(jobId);
        if (!job) { sendJson(res, 404, { ok: false, error: '任务不存在或已过期' }); return; }
        const out = Number.isFinite(after) && after > 0 ? job.output.slice(after) : job.output;
        sendJson(res, 200, {
          ok: true, jobId: job.id, running: job.running, exitCode: job.exitCode,
          truncated: job.truncated, startedAt: job.startedAt, finishedAt: job.finishedAt,
          cwd: job.cwd, command: job.command, output: out, index: job.output.length,
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/shell/stop') {
        if (!auth(req, res)) return;
        const body = await readBody(req);
        const out = stopShellJob(body.jobId);
        sendJson(res, out.ok ? 200 : 404, out);
        return;
      }
      // ---- 会话重命名（转发 DSH session.rename）----
      if (req.method === 'POST' && url.pathname === '/api/dsh-rename') {
        if (!auth(req, res)) return;
        if (typeof executor.renameSession !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        const body = await readBody(req);
        const out = await executor.renameSession(body.sessionId, body.title);
        if (!out.ok) {
          const code = out.code === 'bad-request' ? 400 : 502;
          sendJson(res, code, { ok: false, error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true, title: out.title });
        return;
      }
      // ---- 模型选择（转发 DSH session.models / session.selectModel，对标 DSH Web GUI）----
      if (req.method === 'GET' && url.pathname === '/api/dsh-models') {
        if (!auth(req, res)) return;
        if (typeof executor.getSessionModels !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        const sessionId = (url.searchParams.get('sessionId') || '').trim();
        if (!sessionId) { sendJson(res, 400, { ok: false, error: 'sessionId 不能为空' }); return; }
        try {
          const out = await executor.getSessionModels(sessionId);
          if (!out.ok) { sendJson(res, 502, { ok: false, error: out.error }); return; }
          sendJson(res, 200, { ok: true, current: out.current, routable: out.routable, groups: out.groups, failures: out.failures });
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e) });
        }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/dsh-models') {
        if (!auth(req, res)) return;
        if (typeof executor.selectSessionModel !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        const body = await readBody(req);
        const out = await executor.selectSessionModel({ sessionId: body.sessionId, provider: body.provider, model: body.model, reasoningEffort: body.reasoningEffort });
        if (!out.ok) {
          const code = out.code === 'bad-request' ? 400 : 502;
          sendJson(res, code, { ok: false, error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true, selected: out.selected });
        return;
      }
      // ---- DSH 设置（对标 DSH 桌面设置面板）----
      // GET /api/dsh-settings → settings.describe（关键命名空间）
      if (req.method === 'GET' && url.pathname === '/api/dsh-settings') {
        if (!auth(req, res)) return;
        if (typeof executor.describeSettings !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        try {
          const out = await executor.describeSettings();
          if (!out.ok) { sendJson(res, 502, { ok: false, error: out.error }); return; }
          sendJson(res, 200, { ok: true, writable: out.writable, namespaces: out.namespaces });
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e) });
        }
        return;
      }
      // POST /api/dsh-settings {ns, ops, expectedRevision} → settings.mutate
      if (req.method === 'POST' && url.pathname === '/api/dsh-settings') {
        if (!auth(req, res)) return;
        if (typeof executor.mutateSettings !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        const body = await readBody(req);
        const out = await executor.mutateSettings({ ns: body.ns, ops: body.ops, expectedRevision: body.expectedRevision });
        if (!out.ok) {
          const code = out.code === 'bad-request' ? 400 : 502;
          sendJson(res, code, { ok: false, error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true, ns: out.ns, result: out.result });
        return;
      }
      // ---- DSH 缺口补齐路由 ----
      // 后台任务（events.mux session/jobs 帧实时缓存）：GET /api/dsh-jobs?sessionId=
      if (req.method === 'GET' && url.pathname === '/api/dsh-jobs') {
        if (!auth(req, res)) return;
        const sessionId = (url.searchParams.get('sessionId') || '').trim();
        if (!sessionId) { sendJson(res, 400, { ok: false, error: 'sessionId 不能为空' }); return; }
        try {
          const items = executor.getJobs(sessionId);
          sendJson(res, 200, { ok: true, items });
        } catch (e) { sendJson(res, 500, { ok: false, error: String(e) }); }
        return;
      }
      // 会话日志导出（session.export no-envelope GET）：GET /api/dsh-session-export?sessionId=
      if (req.method === 'GET' && url.pathname === '/api/dsh-session-export') {
        if (!auth(req, res)) return;
        const sessionId = (url.searchParams.get('sessionId') || '').trim();
        if (!sessionId) { sendJson(res, 400, { ok: false, error: 'sessionId 不能为空' }); return; }
        try {
          const out = await executor.exportSessionLog(sessionId);
          if (!out.ok) { sendJson(res, 502, { ok: false, error: out.error }); return; }
          sendJson(res, 200, { ok: true, size: out.size, truncated: out.truncated, content: out.content });
        } catch (e) { sendJson(res, 500, { ok: false, error: String(e) }); }
        return;
      }
      // 子代理 prompt：POST /api/dsh-subagent-prompt {parentSessionId, childSessionId, text}
      if (req.method === 'POST' && url.pathname === '/api/dsh-subagent-prompt') {
        if (!auth(req, res)) return;
        const body = await readBody(req);
        const out = await executor.subagentPrompt({ parentSessionId: body.parentSessionId, childSessionId: body.childSessionId, text: body.text });
        sendJson(res, out.ok ? 200 : 400, out);
        return;
      }
      // 子代理 interrupt：POST /api/dsh-subagent-interrupt {parentSessionId, childSessionId}
      if (req.method === 'POST' && url.pathname === '/api/dsh-subagent-interrupt') {
        if (!auth(req, res)) return;
        const body = await readBody(req);
        const out = await executor.subagentInterrupt({ parentSessionId: body.parentSessionId, childSessionId: body.childSessionId });
        sendJson(res, out.ok ? 200 : 400, out);
        return;
      }
      // ---- 推送通知（Web Push）：/api/push/vapid|register|list|remove|test ----
      if (req.method === 'GET' && url.pathname === '/api/push/vapid') {
        if (!auth(req, res)) return;
        if (!push) { sendJson(res, 501, { ok: false, error: '推送未启用' }); return; }
        sendJson(res, 200, { ok: true, publicKey: push.publicKeyB64 });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/push/register') {
        if (!auth(req, res)) return;
        if (!push) { sendJson(res, 501, { ok: false, error: '推送未启用' }); return; }
        const body = await readBody(req);
        const out = push.store.register(body.subscription, body.deviceLabel || '手机');
        sendJson(res, out.ok ? 200 : 400, out);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/push/list') {
        if (!auth(req, res)) return;
        if (!push) { sendJson(res, 501, { ok: false, error: '推送未启用' }); return; }
        sendJson(res, 200, { ok: true, items: push.store.list() });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/push/remove') {
        if (!auth(req, res)) return;
        if (!push) { sendJson(res, 501, { ok: false, error: '推送未启用' }); return; }
        const body = await readBody(req);
        push.store.remove(String(body.id || ''));
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/push/test') {
        if (!auth(req, res)) return;
        if (!push) { sendJson(res, 501, { ok: false, error: '推送未启用' }); return; }
        const results = await push.store.notifyAll(push.vapidJwk, { kind: 'test', title: 'DeepSeek Harness', body: '推送测试成功 ✅' });
        sendJson(res, 200, { ok: true, results });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/dsh-credentials') {
        if (!auth(req, res)) return;
        const body = await readBody(req);
        if (body.action === 'set') {
          if (typeof executor.credentialsSet !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
          const out = await executor.credentialsSet({ ref: body.ref, value: body.value });
          sendJson(res, out.ok ? 200 : 400, out);
          return;
        }
        if (body.action === 'unset') {
          if (typeof executor.credentialsUnset !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
          const out = await executor.credentialsUnset({ ref: body.ref });
          sendJson(res, out.ok ? 200 : 400, out);
          return;
        }
        sendJson(res, 400, { ok: false, error: 'action 必填 (set|unset)' });
        return;
      }
      // ---- Agent 预设（模式切换：标准/PTC/极简/创造）----
      if (req.method === 'GET' && url.pathname === '/api/dsh-presets') {
        if (!auth(req, res)) return;
        if (typeof executor.listAgentPresets !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        try {
          const out = await executor.listAgentPresets();
          if (!out.ok) { sendJson(res, 502, { ok: false, error: out.error }); return; }
          sendJson(res, 200, { ok: true, presets: out.presets, authorable: out.authorable });
        } catch (e) { sendJson(res, 500, { ok: false, error: String(e) }); }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/dsh-presets') {
        if (!auth(req, res)) return;
        if (typeof executor.selectAgentPreset !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        const body = await readBody(req);
        const out = await executor.selectAgentPreset({ sessionId: body.sessionId, agentPreset: body.agentPreset });
        if (!out.ok) {
          const code = out.code === 'bad-request' ? 400 : 502;
          sendJson(res, code, { ok: false, error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true, agentPreset: out.agentPreset });
        return;
      }
      // ---- 会话分支（fork）----
      if (req.method === 'POST' && url.pathname === '/api/dsh-fork') {
        if (!auth(req, res)) return;
        if (typeof executor.forkSession !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        const body = await readBody(req);
        const out = await executor.forkSession(body.sessionId);
        if (!out.ok) {
          const code = out.code === 'bad-request' ? 400 : 502;
          sendJson(res, code, { ok: false, error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true, sessionId: out.sessionId });
        return;
      }
      // ---- 技能列表（skill.list，scoped 需 sessionId）----
      if (req.method === 'GET' && url.pathname === '/api/dsh-skill') {
        if (!auth(req, res)) return;
        if (typeof executor.listSkills !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        const sessionId = (url.searchParams.get('sessionId') || '').trim();
        if (!sessionId) { sendJson(res, 400, { ok: false, error: 'sessionId 不能为空' }); return; }
        try {
          const out = await executor.listSkills(sessionId);
          if (!out.ok) { sendJson(res, 502, { ok: false, error: out.error }); return; }
          sendJson(res, 200, { ok: true, skills: out.skills });
        } catch (e) { sendJson(res, 500, { ok: false, error: String(e) }); }
        return;
      }
      // ---- 目标（goal）：GET 读状态 / POST 变更 ----
      if (req.method === 'GET' && url.pathname === '/api/dsh-goals') {
        if (!auth(req, res)) return;
        if (typeof executor.getSessionGoal !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        const sessionId = (url.searchParams.get('sessionId') || '').trim();
        if (!sessionId) { sendJson(res, 400, { ok: false, error: 'sessionId 不能为空' }); return; }
        try {
          const out = await executor.getSessionGoal(sessionId);
          if (!out.ok) { sendJson(res, 502, { ok: false, error: out.error }); return; }
          sendJson(res, 200, { ok: true, goal: out.goal });
        } catch (e) { sendJson(res, 500, { ok: false, error: String(e) }); }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/dsh-goals') {
        if (!auth(req, res)) return;
        if (typeof executor.mutateGoal !== 'function') { sendJson(res, 501, { ok: false, error: 'executor 不支持该能力' }); return; }
        const body = await readBody(req);
        const out = await executor.mutateGoal({ action: body.action, sessionId: body.sessionId, objective: body.objective, maxGoalRounds: body.maxGoalRounds, ref: body.ref });
        if (!out.ok) {
          const code = out.code === 'bad-request' ? 400 : 502;
          sendJson(res, code, { ok: false, error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true, ...{ ref: out.ref, cleared: out.cleared } });
        return;
      }
      // ---- 工作区管理：POST /api/dsh-workspace-op {action: create|rename|delete, ...} ----
      if (req.method === 'POST' && url.pathname === '/api/dsh-workspace-op') {
        if (!auth(req, res)) return;
        const body = await readBody(req);
        const action = String(body.action || '');
        let out;
        try {
          if (action === 'create') out = await executor.createWorkspace(body.path);
          else if (action === 'rename') out = await executor.renameWorkspace(body.workspaceId, body.title);
          else if (action === 'delete') out = await executor.deleteWorkspace(body.workspaceId);
          else { sendJson(res, 400, { ok: false, error: 'action 只允许 create/rename/delete' }); return; }
        } catch (e) { sendJson(res, 500, { ok: false, error: String(e) }); return; }
        if (!out.ok) {
          const code = out.code === 'bad-request' ? 400 : 502;
          sendJson(res, code, { ok: false, error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true, ...out });
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
