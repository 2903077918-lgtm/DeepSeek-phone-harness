#!/usr/bin/env node
// phone-harness Agent —— 手机远程控制 DSH 的电脑端旁路程序（MVP）
// 监听局域网端口，收到手机指令后调用 `dsh --profile headless` 执行并回传结果。
// 安全：Bearer token 认证；仅设计为局域网使用，勿直接暴露公网。
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.json');
const HISTORY_PATH = path.join(__dirname, 'history.json');
const PORT = 8788; // 8787 已被本机 Codex Relay 占用，MVP 使用 8788
const HOST = '0.0.0.0'; // 局域网可访问；公网使用需前置安全网关
const DSH_CMD = 'dsh';
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 单任务最长 10 分钟

// ---- 解析 DEEPSEEK_API_KEY：进程环境 → 注册表 User 环境 → .env 文件 ----
function resolveApiKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  try {
    const regOut = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'DEEPSEEK_API_KEY'], { encoding: 'utf8', windowsHide: true });
    const m = /DEEPSEEK_API_KEY\s+REG_SZ\s+(.+)/.exec(regOut);
    if (m) return m[1].trim();
  } catch { /* registry unavailable */ }
  try {
    const envFile = path.join(__dirname, '.env');
    if (existsSync(envFile)) {
      const line = readFileSync(envFile, 'utf8').split('\n').find(l => l.startsWith('DEEPSEEK_API_KEY='));
      if (line) return line.slice('DEEPSEEK_API_KEY='.length).trim();
    }
  } catch { /* no .env */ }
  return undefined;
}
const API_KEY = resolveApiKey();

// ---- 配置：token 首次启动自动生成 ----
function loadConfig() {
  if (existsSync(CONFIG_PATH)) {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  }
  const cfg = { token: crypto.randomBytes(24).toString('hex'), createdAt: new Date().toISOString() };
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return cfg;
}

// ---- 历史记录 ----
function loadHistory() {
  if (!existsSync(HISTORY_PATH)) return [];
  try { return JSON.parse(readFileSync(HISTORY_PATH, 'utf8')); } catch { return []; }
}
function appendHistory(entry) {
  const h = loadHistory();
  h.unshift(entry);
  writeFileSync(HISTORY_PATH, JSON.stringify(h.slice(0, 200), null, 2));
}

// ---- 调用 dsh headless ----
function runTask(task) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (!env.DEEPSEEK_API_KEY && API_KEY) env.DEEPSEEK_API_KEY = API_KEY;
    const started = Date.now();
    const child = spawn(DSH_CMD, ['--profile', 'headless', task], { env, shell: true });
    let stdout = '', stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      // 超时：杀整个进程树（dsh 经 shell 启动，可能有子进程）
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        } else {
          child.kill('SIGKILL');
        }
      } catch { /* already gone */ }
      finish({ ok: false, exitCode: -1, stdout: stdout.trim(), stderr: (stderr + '\n[超时] 任务超过 ' + TASK_TIMEOUT_MS / 1000 + 's 被终止').trim(), elapsedMs: Date.now() - started });
    }, TASK_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      finish({
        ok: code === 0,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        elapsedMs: Date.now() - started,
      });
    });
    child.on('error', (e) => {
      finish({ ok: false, exitCode: -1, stdout: stdout.trim(), stderr: String(e), elapsedMs: Date.now() - started });
    });
  });
}

// ---- HTTP 服务 ----
const config = loadConfig();
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

// ---- 并发控制：FIFO 队列，同一时间只跑一个任务 ----
const queue = (() => {
  let tail = Promise.resolve();
  return {
    async enqueue(fn) {
      const run = tail.then(fn, fn);
      tail = run.catch(() => {});
      return run;
    },
    get size() { return 0; }, // 简单实现不追踪队列长度
  };
})();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      // 优先使用独立网页控制台（web/index.html，Agent B 维护）；不存在时退回内嵌版
      const webFile = path.join(__dirname, 'web', 'index.html');
      if (existsSync(webFile)) {
        res.end(readFileSync(webFile, 'utf8'));
      } else {
        res.end(INDEX_HTML);
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      if (!auth(req, res)) return;
      sendJson(res, 200, { ok: true, agent: 'deepseekharness-relay', version: '0.2.0', time: new Date().toISOString() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/history') {
      if (!auth(req, res)) return;
      sendJson(res, 200, { ok: true, items: loadHistory() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/exec') {
      if (!auth(req, res)) return;
      const body = await readBody(req);
      const task = String(body.task || '').trim();
      if (!task) { sendJson(res, 400, { ok: false, error: 'task 不能为空' }); return; }
      // 排队执行：同一时间只跑一个任务，其余等待
      const taskKey = crypto.randomUUID();
      await queue.enqueue(async () => {
        const result = await runTask(task);
        appendHistory({ id: crypto.randomUUID(), task, ...result, at: new Date().toISOString() });
        return result;
      }).then((result) => {
        sendJson(res, 200, { ok: true, result });
      }).catch((e) => {
        sendJson(res, 500, { ok: false, error: String(e) });
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String(e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log('==============================================');
  console.log(' phone-harness Agent 已启动 (v0.1.0 MVP)');
  console.log('----------------------------------------------');
  console.log(' 控制台: http://<本机局域网IP>:' + PORT);
  console.log(' 本机:   http://127.0.0.1:' + PORT);
  console.log(' Token:  ' + config.token);
  console.log('----------------------------------------------');
  console.log(' 手机使用: 同一 WiFi 下访问 http://<电脑IP>:' + PORT);
  console.log(' 安全: 仅限局域网；请勿将本端口暴露到公网。');
  console.log('==============================================');
});

// ---- 网页控制台（内联单页）----
const INDEX_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>phone-harness 远程控制台</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 20px 16px 60px; }
  h1 { font-size: 20px; margin-bottom: 4px; color: #fff; }
  .sub { font-size: 12px; color: #94a3b8; margin-bottom: 20px; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
  label { display: block; font-size: 13px; color: #94a3b8; margin-bottom: 8px; }
  textarea { width: 100%; min-height: 90px; background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 8px; padding: 12px; font-size: 15px; resize: vertical; }
  button { background: #3b82f6; color: #fff; border: none; border-radius: 8px; padding: 12px 20px; font-size: 15px; width: 100%; cursor: pointer; }
  button:disabled { background: #475569; cursor: not-allowed; }
  .status { font-size: 12px; color: #94a3b8; margin-top: 8px; }
  .result { margin-top: 16px; }
  .result pre { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px; font-size: 13px; white-space: pre-wrap; word-break: break-word; max-height: 50vh; overflow-y: auto; }
  .history-item { border-top: 1px solid #334155; padding: 10px 0; }
  .history-item .task { font-size: 14px; }
  .history-item .meta { font-size: 11px; color: #64748b; margin-top: 4px; }
  .history-item .out { font-size: 12px; color: #cbd5e1; margin-top: 6px; white-space: pre-wrap; word-break: break-word; max-height: 120px; overflow-y: auto; }
  .err { color: #f87171; }
</style>
</head>
<body>
<div class="wrap">
  <h1>📱 phone-harness 远程控制台</h1>
  <div class="sub">手机远程控制电脑上的 DSH · MVP</div>

  <div class="card">
    <label for="token">访问令牌（Agent 启动时打印，首次输入后自动保存）</label>
    <textarea id="token" rows="1" placeholder="粘贴 Agent 控制台输出的 Token"></textarea>
  </div>

  <div class="card">
    <label for="task">输入任务指令（自然语言，发给电脑上的 DSH 执行）</label>
    <textarea id="task" placeholder="例如：检查一下 C 盘剩余空间"></textarea>
    <div style="margin-top:12px"><button id="run" onclick="runTask()">🚀 发送任务</button></div>
    <div class="status" id="status"></div>
    <div class="result" id="result" style="display:none">
      <label>执行结果</label>
      <pre id="resultText"></pre>
    </div>
  </div>

  <div class="card">
    <label>最近任务</label>
    <div id="history"><div style="color:#64748b;font-size:13px">暂无记录</div></div>
  </div>
</div>
<script>
  let token = localStorage.getItem('ph_token') || '';
  document.getElementById('token').value = token;
  function getToken() {
    token = document.getElementById('token').value.trim();
    if (token) localStorage.setItem('ph_token', token);
    return token;
  }
  async function api(path, opts = {}) {
    const headers = { 'content-type': 'application/json', 'authorization': 'Bearer ' + getToken() };
    const r = await fetch(path, { ...opts, headers });
    if (r.status === 401) throw new Error('令牌无效，请检查 Token');
    return r.json();
  }
  async function runTask() {
    const task = document.getElementById('task').value.trim();
    const btn = document.getElementById('run');
    const status = document.getElementById('status');
    const result = document.getElementById('result');
    if (!task) { status.textContent = '请先输入任务'; return; }
    btn.disabled = true; status.textContent = '⏳ 正在执行（DSH 工作中，最长 10 分钟）...';
    result.style.display = 'none';
    try {
      const resp = await api('/api/exec', { method: 'POST', body: JSON.stringify({ task }) });
      result.style.display = 'block';
      const r = resp.result || {};
      document.getElementById('resultText').textContent =
        (r.ok ? '✅ 完成（' + (r.elapsedMs/1000).toFixed(1) + 's）\\n\\n' : '❌ 失败（exit ' + r.exitCode + '）\\n\\n') +
        (r.stdout || '(无输出)') + (r.stderr ? '\\n\\n[stderr]\\n' + r.stderr : '');
      status.textContent = '';
      loadHistory();
    } catch (e) {
      status.textContent = '❌ ' + e.message;
    } finally { btn.disabled = false; }
  }
  async function loadHistory() {
    try {
      const resp = await api('/api/history');
      const box = document.getElementById('history');
      if (!resp.items || resp.items.length === 0) { box.innerHTML = '<div style="color:#64748b;font-size:13px">暂无记录</div>'; return; }
      box.innerHTML = resp.items.slice(0, 10).map(h => \`
        <div class="history-item">
          <div class="task">\${h.task.slice(0, 60)}</div>
          <div class="meta">\${h.ok ? '✅' : '❌'} \${new Date(h.at).toLocaleString()} · \${(h.elapsedMs/1000).toFixed(1)}s</div>
          <div class="out">\${(h.stdout || h.stderr || '').slice(0, 200)}</div>
        </div>\`).join('');
    } catch (e) { /* 未认证时静默 */ }
  }
  loadHistory();
  setInterval(loadHistory, 15000);
</script>
</body>
</html>`;
