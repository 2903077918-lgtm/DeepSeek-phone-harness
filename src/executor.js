// src/executor.js —— 任务执行器（headless 后端 + Web API 后端可选）
// 抽象：executor.run(task, {sessionId}, onDelta) → Promise<result>
// 后端选择：mode=lan 用 headless（默认）；mode=both 时 headless 保底、Web API 优先
// 会话连续性：Web API 后端维护 sessionId 注册表（sessions.json 持久化，重启可恢复）；
//   run 时复用调用方指定会话（或最近使用的现有会话），DSH 因此保留多轮上下文。
// 审批转发/事件流缓冲已拆到独立模块 src/approval-relay.js（createApprovalRelay）；
// DSH RPC/事件归一化/路径工具已拆到 src/dsh-utils.js。
// 本文件专注：执行器 + 会话注册表 + DSH 只读同步 / 继续会话 / 取消 / 子代理 API。
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DSH_CMD, TASK_TIMEOUT_MS, resolveApiKey } from './config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRpc, sleep, isoTime, historyToMessages, normPath, baseName } from './dsh-utils.js';
import { createApprovalRelay } from './approval-relay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const API_KEY = resolveApiKey(ROOT_DIR);
const MAX_REGISTERED_SESSIONS = 100; // 注册表上限，超出按 lastUsedAt 淘汰最旧

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

// ---- Web API 后端（复用指定会话，实现多轮对话）----
// sessionId 由调用方（注册表）给出；这里只负责 prompt + 轮询"本轮"增量。
// 提交前先记录历史进度，输出与结束判定都只针对提交之后新增的事件，
// 因此复用旧会话时不会把历史对话混入本轮结果。
async function runWebApi(task, onDelta, sessionId) {
  const started = Date.now();
  try {
    // 1. 记录提交前的历史进度（重试 3 次；仍失败视为后端不可用，交由调用方回退 headless）
    let startLen = 0;
    let preTurnEnds = 0;
    for (let i = 0; i < 3; i++) {
      try {
        const value = await fetchRpc('session.history', { sessionId });
        const events = value.events || [];
        startLen = events.length;
        preTurnEnds = events.filter((e) => e.event?.type === 'turn/end').length;
        break;
      } catch (e) {
        if (i === 2) throw e;
        await sleep(500);
      }
    }

    // 2. 提交任务（复用会话 → DSH 保留上下文）
    await fetchRpc('session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: task }],
    });

    // 3. 轮询历史直到本轮 turn/end 或超时
    const deadline = Date.now() + TASK_TIMEOUT_MS;
    let lastText = '';
    while (Date.now() < deadline) {
      await sleep(1500);
      let events = [];
      try {
        const value = await fetchRpc('session.history', { sessionId });
        events = value.events || [];
      } catch {
        continue; // 单次轮询失败先跳过，等下一轮
      }
      // 只取提交之后新增的事件，避免带上历史对话
      const newEvents = events.length > startLen ? events.slice(startLen) : [];
      const assistantText = newEvents
        .filter((e) => e.event?.type === 'assistant/message')
        .flatMap((e) => e.event.data?.message?.content || [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
      if (assistantText && assistantText !== lastText) {
        const delta = assistantText.length > lastText.length ? assistantText.slice(lastText.length) : assistantText;
        lastText = assistantText;
        onDelta?.(delta + '\n');
      }
      // 本轮结束判定：新增事件里出现 turn/end，或总 turn/end 数超过提交前
      const newTurnEnds = newEvents.filter((e) => e.event?.type === 'turn/end').length;
      const totalTurnEnds = events.filter((e) => e.event?.type === 'turn/end').length;
      if (newTurnEnds > 0 || totalTurnEnds > preTurnEnds) {
        return { ok: true, exitCode: 0, stdout: lastText, stderr: '', elapsedMs: Date.now() - started, backend: 'webapi', sessionId };
      }
    }
    return { ok: false, exitCode: -1, stdout: lastText, stderr: '[超时] Web API 后端等待结果超时', elapsedMs: Date.now() - started, backend: 'webapi', sessionId };
  } catch (e) {
    return { ok: false, exitCode: -1, stdout: '', stderr: 'Web API 后端不可用: ' + String(e), elapsedMs: Date.now() - started, backend: 'webapi', sessionId };
  }
}

// ---- 执行器入口：mode=both 时优先 Web API（复用会话），失败回退 headless ----
export function createExecutor({ mode = 'lan', sessionsDir = ROOT_DIR } = {}) {
  // ---- 会话注册表：内存 Map + sessions.json 持久化（重启可恢复）----
  const registry = new Map();
  const SESSIONS_PATH = path.join(sessionsDir, 'sessions.json');

  function loadRegistry() {
    try {
      if (!existsSync(SESSIONS_PATH)) return;
      const arr = JSON.parse(readFileSync(SESSIONS_PATH, 'utf8'));
      if (!Array.isArray(arr)) return;
      for (const s of arr) {
        if (s && s.sessionId && s.backend === 'webapi') {
          registry.set(s.sessionId, {
            sessionId: s.sessionId,
            backend: 'webapi',
            createdAt: s.createdAt || new Date().toISOString(),
            lastUsedAt: s.lastUsedAt || new Date().toISOString(),
          });
        }
      }
    } catch {
      // 文件损坏等异常 → 从空注册表开始
    }
  }
  function saveRegistry() {
    try {
      writeFileSync(SESSIONS_PATH, JSON.stringify([...registry.values()], null, 2));
    } catch {
      // 持久化失败不阻塞执行（内存注册表仍可用）
    }
  }
  function register(sessionId) {
    const now = new Date().toISOString();
    const s = { sessionId, backend: 'webapi', createdAt: now, lastUsedAt: now };
    registry.set(sessionId, s);
    if (registry.size > MAX_REGISTERED_SESSIONS) {
      const oldest = [...registry.values()].sort((a, b) => String(a.lastUsedAt || '').localeCompare(String(b.lastUsedAt || '')))[0];
      if (oldest) registry.delete(oldest.sessionId);
    }
    saveRegistry();
    return s;
  }
  function touch(sessionId) {
    const s = registry.get(sessionId);
    if (!s) return;
    s.lastUsedAt = new Date().toISOString();
    saveRegistry();
  }

  // 强制新建一个 Web API 会话并注册（POST /api/sessions 用）
  async function createSession() {
    const value = await fetchRpc('session.create', { cwd: ROOT_DIR, agentPreset: 'standard' });
    if (!value?.sessionId) throw new Error('session.create 未返回 sessionId');
    return register(value.sessionId);
  }

  // 返回现有 webapi 会话（最近使用优先）；无则新建（run 默认路径用）
  async function ensureSession() {
    if (registry.size === 0) return createSession();
    const sorted = [...registry.values()].sort((a, b) => String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')));
    return sorted[0];
  }

  loadRegistry();

  const executor = {
    mode,
    // 注册表快照（按最近使用排序），供 GET /api/sessions 使用
    listSessions() {
      return [...registry.values()]
        .sort((a, b) => String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')))
        .map((s) => ({ ...s }));
    },
    ensureSession,
    createSession,
    // 兼容旧调用 run(task, onDelta)；新调用 run(task, { sessionId }, onDelta)
    async run(task, optsOrOnDelta, onDelta) {
      let opts = {};
      if (typeof optsOrOnDelta === 'function') {
        onDelta = optsOrOnDelta;
      } else if (optsOrOnDelta && typeof optsOrOnDelta === 'object') {
        opts = optsOrOnDelta;
      }

      // lan 模式：行为完全不变，一律 headless（忽略 sessionId）
      if (mode !== 'both') return runHeadless(task, onDelta);

      let sessionId = opts.sessionId;
      if (sessionId && !registry.has(sessionId)) sessionId = undefined; // 指定会话不存在 → 走默认逻辑

      // 指定会话：直接复用（保留上下文）
      if (sessionId) {
        const webResult = await runWebApi(task, onDelta, sessionId);
        touch(sessionId);
        if (webResult.ok || !webResult.stderr.includes('不可用')) return webResult;
        return runHeadless(task, onDelta); // Web API 失败 → 回退 headless
      }

      // 默认：复用现有会话（会话连续性）或新建；Web API 不可用则回退 headless
      let sess;
      try {
        sess = await ensureSession();
      } catch {
        return runHeadless(task, onDelta);
      }
      const webResult = await runWebApi(task, onDelta, sess.sessionId);
      touch(sess.sessionId);
      if (webResult.ok || !webResult.stderr.includes('不可用')) return webResult;
      return runHeadless(task, onDelta);
    },
    // ---- DSH 只读同步 API（转发并归一化，供手机端浏览电脑上的项目/会话）----
    // GET /api/dsh-workspaces：workspace.list + 按 cwd 前缀重新分组
    // （workspace.sessionIds 可能不准——实测多数为空——故以 session.list 的 cwd 前缀为准，
    //  与声明的 sessionIds 取并集计数；长路径优先匹配，避免嵌套工作区归属错误）
    // 按 basename 去重合并同名工作区（如多个 voltex-ai-platform → 1 个，sessionCount 累加）
    async listDshWorkspaces() {
      const [wsValue, slValue] = await Promise.all([
        fetchRpc('workspace.list', {}),
        fetchRpc('session.list', {}),
      ]);
      const workspaces = (wsValue && wsValue.items) || [];
      const sessions = (slValue && slValue.items) || [];
      const matched = new Map(); // workspaceId -> Set<sessionId>
      for (const w of workspaces) matched.set(w.workspaceId, new Set((w.sessionIds || []).filter(Boolean)));
      const sorted = [...workspaces].sort((a, b) => normPath(b.path).length - normPath(a.path).length);
      for (const s of sessions) {
        const cwd = normPath(s.cwd);
        if (!cwd) continue;
        const ws = sorted.find((w) => {
          const p = normPath(w.path);
          return cwd === p || cwd.startsWith(p + '/');
        });
        if (ws) { const set = matched.get(ws.workspaceId); if (set) set.add(s.sessionId); }
      }
      // 按 basename 去重合并
      const byBasename = new Map(); // basename -> merged workspace
      for (const w of workspaces) {
        const bn = baseName(w.path);
        const existing = byBasename.get(bn);
        if (existing) {
          existing.sessionCount += (matched.get(w.workspaceId) || new Set()).size;
          if (!existing.title && w.title) existing.title = w.title;
        } else {
          byBasename.set(bn, {
            workspaceId: w.workspaceId,
            path: w.path,
            title: w.title || null,
            sessionCount: (matched.get(w.workspaceId) || new Set()).size,
          });
        }
      }
      return [...byBasename.values()];
    },
    // GET /api/dsh-sessions：session.list 归一化（title 取自 projections，零额外 RPC）
    // 可选 withCount=true：对每个会话取消息数（session.history 事件数）——只给 UI 打开的项目用，避免全量开销
    // 标注 ungrouped=true：cwd 不匹配任何工作区路径的会话（供 UI 显示"未分组"桶）
    async listDshSessions(withCount) {
      const [slValue, wsValue] = await Promise.all([
        fetchRpc('session.list', {}),
        fetchRpc('workspace.list', {}),
      ]);
      const wsPaths = ((wsValue && wsValue.items) || [])
        .map((w) => normPath(w.path))
        .filter(Boolean)
        .sort((a, b) => b.length - a.length); // 最长前缀优先
      const items = ((slValue && slValue.items) || []).map((s) => {
        const cwd = normPath(s.cwd);
        const inWorkspace = cwd && wsPaths.some((p) => cwd === p || cwd.startsWith(p + '/'));
        return {
          sessionId: s.sessionId,
          cwd: s.cwd,
          title: (s.projections && s.projections.values && s.projections.values.title) || undefined,
          updatedAt: isoTime(s.updatedAt),
          running: !!s.running,
          blank: !!s.blank,
          ungrouped: !inWorkspace,
        };
      });
      if (withCount) {
        await Promise.all(items.map(async (s) => {
          try {
            const h = await fetchRpc('session.history', { sessionId: s.sessionId });
            const events = (h && h.events) || [];
            s.messageCount = events.filter((e) => {
              const t = e && e.event && e.event.type;
              return t === 'user/message' || t === 'assistant/message';
            }).length;
          } catch { s.messageCount = undefined; }
        }));
      }
      return items;
    },
    // POST /api/dsh-continue：对 DSH 已有会话继续发消息（不新建、不改注册表）。
    // 复用 runWebApi 的"记录提交前进度 + 只统计本轮增量"逻辑；存在性用一次轻量 session.list 检查。
    async continueSession({ sessionId, task, onDelta } = {}) {
      const sid = String(sessionId || '').trim();
      if (!sid) return { ok: false, code: 'bad-request', error: 'sessionId 不能为空' };
      let known = false;
      try {
        const value = await fetchRpc('session.list', {});
        known = ((value && value.items) || []).some((s) => s.sessionId === sid);
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: 'Web API 后端不可用: ' + String(e) };
      }
      if (!known) return { ok: false, code: 'session-not-found', error: '会话不存在: ' + sid };
      const result = await runWebApi(task, onDelta, sid);
      return { ok: true, sessionId: sid, result };
    },
    // GET /api/dsh-history?sessionId=：转发 session.history 归一化为对话消息
    async getDshHistory(sessionId, limit) {
      const sid = String(sessionId || '').trim();
      if (!sid) throw new Error('sessionId 不能为空');
      const value = await fetchRpc('session.history', { sessionId: sid });
      let items = historyToMessages((value && value.events) || []);
      const n = Number(limit);
      if (Number.isInteger(n) && n > 0 && items.length > n) items = items.slice(-n);
      return items;
    },
    // GET /api/events?sessionId=&afterSeq=：流式增量轮询（缓冲来自 events.mux 的 session/event 帧）
    getEvents(sessionId, afterSeq) {
      return this.relay.getEvents(sessionId, afterSeq);
    },
    // POST /api/cancel：中断正在运行的会话任务（转发 DSH session.cancel）
    async cancelSession(sessionId) {
      const sid = String(sessionId || '').trim();
      if (!sid) return { ok: false, error: 'sessionId 不能为空' };
      try {
        const value = await fetchRpc('session.cancel', { sessionId: sid });
        return { ok: !!(value && value.accepted), accepted: !!(value && value.accepted), sessionId: sid };
      } catch (e) {
        return { ok: false, error: 'session.cancel 失败: ' + String(e) };
      }
    },
    // GET /api/agents?sessionId=：转发 subagent.list，归一化子代理列表
    // DSH subagent.list 请求 {parentSessionId} → {entries, parentAvailable}
    //   每条 entry 探测字段：{kind, id, mode, label, activity, hasChildren}
    //   id=子代理会话 id（childSessionId）；activity 为 'running'|'inactive'（运行中/空闲）
    async listAgents(sessionId) {
      const sid = String(sessionId || '').trim();
      if (!sid) return { ok: false, code: 'bad-request', error: 'sessionId 不能为空' };
      let value;
      try {
        value = await fetchRpc('subagent.list', { parentSessionId: sid });
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: 'subagent.list 失败: ' + String(e) };
      }
      if (!value || typeof value !== 'object') {
        return { ok: false, code: 'bad-response', error: 'subagent.list 返回结构异常' };
      }
      const entries = Array.isArray(value.entries) ? value.entries : [];
      const items = entries.map((e) => ({
        sessionId: String(e && e.id || ''),
        label: typeof (e && e.label) === 'string' ? e.label : '',
        activity: typeof (e && e.activity) === 'string' ? e.activity : undefined,
        kind: typeof (e && e.kind) === 'string' ? e.kind : undefined,
        mode: typeof (e && e.mode) === 'string' ? e.mode : undefined,
        hasChildren: !!(e && e.hasChildren),
      }));
      return { ok: true, parentAvailable: !!value.parentAvailable, items };
    },
  };

  // 审批转发中继：懒创建单例（首次访问 executor.relay 才建立常驻 WebSocket 连接）。
  // transport 在装配时访问一次 executor.relay，即实现"服务启动即监听审批"；
  // 不访问则不产生任何连接/定时器（lan 模式或测试场景零副作用）。
  let relayInstance = null;
  Object.defineProperty(executor, 'relay', {
    enumerable: true,
    get() {
      if (!relayInstance) relayInstance = createApprovalRelay();
      return relayInstance;
    },
  });
  return executor;
}
