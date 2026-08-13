// src/executor.js —— 任务执行器（headless 后端 + Web API 后端可选）
// 抽象：executor.run(task, {onDelta}) → Promise<result>
// 后端选择：mode=lan 用 headless（默认）；mode=both 时 headless 保底、Web API 优先
import { spawn, execFileSync } from 'node:child_process';
import { DSH_CMD, TASK_TIMEOUT_MS, resolveApiKey } from './config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const API_KEY = resolveApiKey(ROOT_DIR);

// ---- headless 后端（保底，已验证可用）----
function runHeadless(task, onDelta) {
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
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        } else {
          child.kill('SIGKILL');
        }
      } catch { /* already gone */ }
      finish({ ok: false, exitCode: -1, stdout: stdout.trim(), stderr: (stderr + '\n[超时] 任务超过 ' + TASK_TIMEOUT_MS / 1000 + 's 被终止').trim(), elapsedMs: Date.now() - started, backend: 'headless' });
    }, TASK_TIMEOUT_MS);
    child.stdout.on('data', (d) => {
      stdout += d;
      onDelta?.(d.toString());
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      finish({ ok: code === 0, exitCode: code, stdout: stdout.trim(), stderr: stderr.trim(), elapsedMs: Date.now() - started, backend: 'headless' });
    });
    child.on('error', (e) => {
      finish({ ok: false, exitCode: -1, stdout: stdout.trim(), stderr: String(e), elapsedMs: Date.now() - started, backend: 'headless' });
    });
  });
}

// ---- Web API 后端（127.0.0.1:3080，可选；通过 dsh web 的 HTTP RPC 执行）----
// 实现说明：session.create 创建会话 → session.prompt 提交任务 → 轮询 session.history 取结果。
// 因涉及会话生命周期管理，作为增量能力逐步完善；当前若启用失败则自动回退 headless。
async function runWebApi(task, onDelta) {
  const base = 'http://127.0.0.1:3080';
  const started = Date.now();
  try {
    // 1. 创建会话
    const createResp = await fetch(base + '/api/session.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request', rpcId: cryptoRandom(), method: 'session.create',
        payload: { cwd: ROOT_DIR, agentPreset: 'standard' },
      }),
    });
    if (!createResp.ok) throw new Error('session.create HTTP ' + createResp.status);
    const createJson = await createResp.json();
    if (!createJson.result?.ok) throw new Error('session.create failed: ' + JSON.stringify(createJson.result?.error || {}).slice(0, 200));
    const sessionId = createJson.result.value.sessionId;

    // 2. 提交任务
    const promptResp = await fetch(base + '/api/session.prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request', rpcId: cryptoRandom(), method: 'session.prompt',
        payload: { sessionId, mode: 'queue', content: [{ type: 'text', text: task }] },
      }),
    });
    const promptJson = await promptResp.json();
    if (!promptJson.result?.ok) throw new Error('session.prompt failed: ' + JSON.stringify(promptJson.result?.error || {}).slice(0, 200));

    // 3. 轮询历史直到 turn/end 或超时
    const deadline = Date.now() + TASK_TIMEOUT_MS;
    let lastText = '';
    while (Date.now() < deadline) {
      await sleep(1500);
      const histResp = await fetch(base + '/api/session.history', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request', rpcId: cryptoRandom(), method: 'session.history',
          payload: { sessionId },
        }),
      });
      const histJson = await histResp.json();
      if (!histJson.result?.ok) continue;
      const events = histJson.result.value.events || [];
      // 提取最新的 assistant 文本
      const assistantText = events
        .filter(e => e.event?.type === 'assistant/message')
        .flatMap(e => e.event.data?.message?.content || [])
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('');
      if (assistantText && assistantText !== lastText) {
        lastText = assistantText;
        onDelta?.(assistantText.slice(lastText.length) + '\n');
      }
      const hasTurnEnd = events.some(e => e.event?.type === 'turn/end');
      if (hasTurnEnd) {
        return { ok: true, exitCode: 0, stdout: lastText, stderr: '', elapsedMs: Date.now() - started, backend: 'webapi' };
      }
    }
    return { ok: false, exitCode: -1, stdout: lastText, stderr: '[超时] Web API 后端等待结果超时', elapsedMs: Date.now() - started, backend: 'webapi' };
  } catch (e) {
    return { ok: false, exitCode: -1, stdout: '', stderr: 'Web API 后端不可用: ' + String(e), elapsedMs: Date.now() - started, backend: 'webapi' };
  }
}

function cryptoRandom() {
  return 'rpc-' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- 执行器入口：mode=both 时优先 Web API，失败回退 headless ----
export function createExecutor({ mode = 'lan' } = {}) {
  return {
    async run(task, onDelta) {
      if (mode === 'both') {
        const webResult = await runWebApi(task, onDelta);
        if (webResult.ok || !webResult.stderr.includes('不可用')) return webResult;
        // 回退 headless
        return runHeadless(task, onDelta);
      }
      return runHeadless(task, onDelta);
    },
  };
}
