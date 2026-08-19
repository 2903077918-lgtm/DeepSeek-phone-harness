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
import { fetchRpc, sleep, isoTime, historyToMessages, normPath, baseName, cryptoRandom, WEB_API_BASE } from './dsh-utils.js';
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
// images: [{mediaType, data(base64), name?}] 随任务作为 image content part 提交
async function runWebApi(task, onDelta, sessionId, images) {
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

    // 2. 提交任务（复用会话 → DSH 保留上下文；可选图片附件）
    const content = [{ type: 'text', text: task }];
    for (const img of images || []) {
      if (img && typeof img.data === 'string' && img.data) {
        content.push({
          type: 'image',
          mediaType: String(img.mediaType || 'image/jpeg'),
          data: img.data,
          ...(img.name ? { name: String(img.name) } : {}),
        });
      }
    }
    await fetchRpc('session.prompt', {
      sessionId,
      mode: 'queue',
      content,
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
  // agentPreset：指定模式（standard/minimal/code/cordis 等，默认 standard）；随任务也可指定
  async function createSession(agentPreset) {
    const payload = { cwd: ROOT_DIR, agentPreset: String(agentPreset || 'standard') };
    const value = await fetchRpc('session.create', payload);
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
    // 每个真实工作区返回独立项（保留真实 workspaceId + path），避免 basename 合并导致按工作区过滤错乱。
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
      return workspaces
        .map((w) => ({
          workspaceId: w.workspaceId,
          path: w.path,
          title: w.title || null,
          sessionCount: (matched.get(w.workspaceId) || new Set()).size,
        }))
        .sort((a, b) => b.sessionCount - a.sessionCount || String(a.path).localeCompare(String(b.path)));
    },
    // GET /api/dsh-sessions：session.list 归一化（title 取自 projections，零额外 RPC）
    // 可选 workspaceId：只返回该工作区下的会话（按 cwd 前缀匹配 + workspace.sessionIds 兜底）；
    //   workspaceId 空缺时返回全部（供 openSession/全量浏览）。
    // 可选 withCount=true：对每个会话取消息数（session.history 事件数）——只给 UI 打开的项目用，避免全量开销
    // 标注 ungrouped=true：cwd 不匹配任何工作区路径的会话（供 UI 显示"未分组"桶）
    async listDshSessions(workspaceId, withCount) {
      const [slValue, wsValue] = await Promise.all([
        fetchRpc('session.list', {}),
        fetchRpc('workspace.list', {}),
      ]);
      const workspaces = (wsValue && wsValue.items) || [];
      const wsPaths = workspaces.map((w) => normPath(w.path)).filter(Boolean).sort((a, b) => b.length - a.length); // 最长前缀优先
      let targetWs = null;
      if (workspaceId) targetWs = workspaces.find((w) => w.workspaceId === workspaceId) || null;
      const targetWsPaths = targetWs ? [normPath(targetWs.path)].filter(Boolean) : wsPaths;
      const targetSessionIds = targetWs ? new Set((targetWs.sessionIds || []).filter(Boolean)) : null;
      const inTarget = (s) => {
        if (!workspaceId) return true; // 全量
        const cwd = normPath(s.cwd);
        if (cwd && targetWsPaths.some((p) => p && (cwd === p || cwd.startsWith(p + '/')))) return true;
        return !!targetSessionIds && targetSessionIds.has(s.sessionId);
      };
      const items = ((slValue && slValue.items) || []).filter((s) => inTarget(s)).map((s) => {
        const cwd = normPath(s.cwd);
        const inWorkspace = cwd && wsPaths.some((p) => cwd === p || cwd.startsWith(p + '/'));
        const proj = (s.projections && s.projections.values) || {};
        const stats = proj.sessionStats || {};
        const tu = proj.tokenUsage || {};
        return {
          sessionId: s.sessionId,
          cwd: s.cwd,
          title: proj.title || undefined,
          updatedAt: isoTime(s.updatedAt),
          running: !!s.running,
          blank: !!s.blank,
          ungrouped: !inWorkspace,
          // 会话元数据（手机端状态标记 / 元数据展示用）
          permissions: proj.permissions || undefined,
          tokenUsage: Object.keys(tu).length ? tu : undefined,
          contextPressure: proj.contextPressure || undefined,
          goal: proj.goal || undefined,
          stats: Object.keys(stats).length ? stats : undefined,
          // 任务清单(todo_write) + 计划模式
          todos: Array.isArray(proj.todos) ? proj.todos : undefined,
          plan: proj.plan || undefined,
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
    // images: [{mediaType, data, name?}] 随任务提交（图片附件）
    // interrupt: true → 先 session.cancel 结束当前 turn，再插入新消息（运行中追加信息/重定向）
    async continueSession({ sessionId, task, images, interrupt, onDelta } = {}) {
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
      if (interrupt) {
        // 先打断当前 turn（保留上下文），再插入新消息
        try { await fetchRpc('session.cancel', { sessionId: sid }); } catch { /* ignore */ }
        await sleep(600);
      }
      const result = await runWebApi(task, onDelta, sid, images);
      // 任务完成推送（手机可能在后台）
      notifyTaskDone(sid, !!(result && result.ok), (result && (result.stdout || result.stderr)) || '');
      return { ok: true, sessionId: sid, interrupt: !!interrupt, result };
    },
    // GET /api/dsh-history?sessionId=：转发 session.history 归一化为对话消息
    // GET /api/dsh-history[?sessionId=&maxMessages=&beforeSeq=&limit=]：
    // 转发 session.history（beforeSeq/maxMessages 向前翻页），事件→消息归一化，返回 firstSeq/hasMore
    async getDshHistory(sessionId, limit, opts) {
      const sid = String(sessionId || '').trim();
      if (!sid) throw new Error('sessionId 不能为空');
      const o = opts || {};
      const payload = { sessionId: sid };
      if (Number.isInteger(o.maxMessages) && o.maxMessages > 0) payload.maxMessages = o.maxMessages;
      if (Number.isInteger(o.beforeSeq) && o.beforeSeq >= 0) payload.beforeSeq = o.beforeSeq;
      const value = await fetchRpc('session.history', payload);
      const events = (value && value.events) || [];
      const items = historyToMessages(events);
      // 本页事件的最早/最晚 seq + 是否还有更早（hasMore）
      let firstSeq = null, lastSeq = null;
      for (const ev of events) {
        const s = ev && ev.event && typeof ev.event.seq === 'number' ? ev.event.seq : null;
        if (s === null) continue;
        if (firstSeq === null || s < firstSeq) firstSeq = s;
        if (lastSeq === null || s > lastSeq) lastSeq = s;
      }
      const hasMore = !!(value && value.hasMore);
      // 兼容旧调用：limit 在内存里取尾部 N 条
      const n = Number(limit);
      if (Number.isInteger(n) && n > 0 && items.length > n) items = items.slice(-n);
      return { items, firstSeq, lastSeq, hasMore };
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
    // POST /api/dsh-rename：重命名 DSH 会话（转发 session.rename）
    async renameSession(sessionId, title) {
      const sid = String(sessionId || '').trim();
      const t = String(title || '').trim();
      if (!sid) return { ok: false, code: 'bad-request', error: 'sessionId 不能为空' };
      if (!t) return { ok: false, code: 'bad-request', error: 'title 不能为空' };
      try {
        const value = await fetchRpc('session.rename', { sessionId: sid, title: t });
        return { ok: true, title: (value && value.title) || t, seq: value && value.seq };
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: 'session.rename 失败: ' + String(e) };
      }
    },
    // POST /api/dsh-fork：分支会话（session.fork → 新 sessionId）
    async forkSession(sessionId) {
      const sid = String(sessionId || '').trim();
      if (!sid) return { ok: false, code: 'bad-request', error: 'sessionId 不能为空' };
      try {
        const value = await fetchRpc('session.fork', { sessionId: sid });
        if (!value || !value.sessionId) return { ok: false, error: 'session.fork 未返回 sessionId' };
        const child = register(value.sessionId);   // 注册到 webapi 会话注册表，供后续复用
        return { ok: true, sessionId: child.sessionId };
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: 'session.fork 失败: ' + String(e) };
      }
    },
    // POST /api/dsh-command {sessionId, line}：执行 DSH 斜杠命令（typert commands/execute，payload {args:{agentId,line}}）
    // 命令：/compact /export /feedback /goal /permission <preset> /plan /model —— 手机端权限切换、命令中心等走这里
    async executeCommand(sessionId, line) {
      const sid = String(sessionId || '').trim();
      const l = String(line || '').trim();
      if (!sid) return { ok: false, code: 'bad-request', error: 'sessionId 不能为空' };
      if (!l) return { ok: false, code: 'bad-request', error: 'line 不能为空' };
      try {
        const resp = await fetch(WEB_API_BASE + '/api/commands/execute', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: cryptoRandom(), method: 'commands/execute', payload: { args: { agentId: sid, line: l } } }),
        });
        if (!resp.ok) return { ok: false, code: 'gateway-unavailable', error: 'commands/execute HTTP ' + resp.status };
        const json = await resp.json();
        if (!json.result || !json.result.ok) {
          const e = (json.result && json.result.error) || {};
          return { ok: false, code: e.code || 'command-failed', error: e.message || '命令执行失败' };
        }
        const v = json.result.value || {};
        return { ok: true, commandId: v.commandId, result: v.result };
      } catch (e) {
        return { ok: false, error: 'commands/execute 失败: ' + String(e) };
      }
    },
    // GET /api/dsh-skill?sessionId=：skill.list → 电脑上的技能列表（skill.list 是 scoped RPC，需 sessionId）
    async listSkills(sessionId) {
      const sid = String(sessionId || '').trim();
      if (!sid) return { ok: false, code: 'bad-request', error: 'sessionId 不能为空' };
      try {
        const value = await fetchRpc('skill.list', { sessionId: sid });
        const skills = Array.isArray(value && value.skills) ? value.skills : [];
        return { ok: true, skills: skills.map((sk) => ({
          id: sk && sk.id, name: sk && sk.name, description: sk && sk.description,
          detail: sk && sk.detail, kind: sk && sk.kind, broken: sk && sk.broken,
        })) };
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: 'skill.list 失败: ' + String(e) };
      }
    },
    // ---- 目标（goal）：状态在 projections.values.goal；mutation 转发 goal.* ----    // GET /api/dsh-goals?sessionId=：读 projections 里的 goal 当前状态
    // projections.values.goal 形如 {goal:{id,revision,objective,phase,maxGoalRounds}, roundsStarted,...}
    // → 拍平返回 {ok, goal: {id,revision,objective,phase,maxGoalRounds,...}, meta}
    async getSessionGoal(sessionId) {
      const sid = String(sessionId || '').trim();
      if (!sid) return { ok: false, code: 'bad-request', error: 'sessionId 不能为空' };
      try {
        const value = await fetchRpc('session.list', {});
        const s = ((value && value.items) || []).find((x) => x.sessionId === sid);
        const proj = (s && s.projections && s.projections.values && s.projections.values.goal) || null;
        const goal = (proj && proj.goal) || null;
        return { ok: true, goal, meta: proj };
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: '读取 goal 失败: ' + String(e) };
      }
    },
    // POST /api/dsh-goals {action, sessionId, objective?, maxGoalRounds?, ref?}：goal.create|edit|pause|resume|complete|clear
    // 除 create 外都需要 ref；前端未传时后端从 goal 投影自动取（避免 clear 等传空 ref 校验失败）
    async mutateGoal({ action, sessionId, objective, maxGoalRounds, ref } = {}) {
      const sid = String(sessionId || '').trim();
      const act = String(action || '');
      if (!sid) return { ok: false, code: 'bad-request', error: 'sessionId 不能为空' };
      const allowed = ['create', 'edit', 'pause', 'resume', 'complete', 'clear'];
      if (!allowed.includes(act)) return { ok: false, code: 'bad-request', error: 'goal 动作只允许 ' + allowed.join('/') };
      // 投影里取当前 goal（供缺省 ref）
      const goalOf = async () => {
        const out = await this.getSessionGoal(sid);
        return out.goal || null;
      };
      try {
        if (act === 'create') {
          const objectiveStr = String(objective || '').trim();
          if (!objectiveStr) return { ok: false, code: 'bad-request', error: 'objective 不能为空' };
          const p = { sessionId: sid, objective: objectiveStr };
          if (Number.isInteger(maxGoalRounds) && maxGoalRounds > 0) p.maxGoalRounds = maxGoalRounds;
          const v = await fetchRpc('goal.create', p);
          return { ok: true, ref: v && v.ref };
        }
        // edit / pause / resume / complete / clear：需要有效 ref
        let useRef = (ref && ref.id && typeof ref.revision === 'number') ? ref : null;
        if (!useRef) {
          const cur = await goalOf();
          if (cur && cur.id && typeof cur.revision === 'number') useRef = { id: cur.id, revision: cur.revision };
        }
        if (!useRef) return { ok: false, code: 'bad-request', error: '找不到目标，无法' + (act === 'clear' ? '清除' : '执行') };
        if (act === 'clear') {
          await fetchRpc('goal.clear', { sessionId: sid, ref: useRef });
          return { ok: true, cleared: true };
        }
        const p = { sessionId: sid, ref: useRef };
        if (act === 'edit') {
          const objectiveStr = String(objective || '').trim();
          if (!objectiveStr) return { ok: false, code: 'bad-request', error: 'objective 不能为空' };
          p.objective = objectiveStr;
          if (Number.isInteger(maxGoalRounds) && maxGoalRounds > 0) p.maxGoalRounds = maxGoalRounds;
        }
        const v = await fetchRpc('goal.' + act, p);
        return { ok: true, ref: (v && v.ref) || useRef };
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: 'goal.' + act + ' 失败: ' + String(e) };
      }
    },
    // ---- 工作区管理：workspace.create|rename|delete ----
    async createWorkspace(wsPath) {
      const p = String(wsPath || '').trim();
      if (!p) return { ok: false, code: 'bad-request', error: '工作区路径不能为空' };
      try {
        const v = await fetchRpc('workspace.create', { path: p });
        return { ok: true, workspace: v && v.workspace, created: !!(v && v.created) };
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: 'workspace.create 失败: ' + String(e) };
      }
    },
    async renameWorkspace(workspaceId, title) {
      const w = String(workspaceId || '').trim();
      const t = String(title || '').trim();
      if (!w || !t) return { ok: false, code: 'bad-request', error: 'workspaceId/title 必填' };
      try {
        const v = await fetchRpc('workspace.rename', { workspaceId: w, title: t });
        return { ok: true, workspace: v && v.workspace };
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: 'workspace.rename 失败: ' + String(e) };
      }
    },
    async deleteWorkspace(workspaceId) {
      const w = String(workspaceId || '').trim();
      if (!w) return { ok: false, code: 'bad-request', error: 'workspaceId 不能为空' };
      try {
        await fetchRpc('workspace.delete', { workspaceId: w });
        return { ok: true, deleted: true };
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: 'workspace.delete 失败: ' + String(e) };
      }
    },
    // ---- DSH 缺口补齐（官方 HTTP 路由表里存在、之前没接的）----
    // 后台任务（events.mux 的 session/jobs 帧缓存，实时）
    getJobs(sessionId) {
      return (this.relay && typeof this.relay.getJobs === 'function') ? this.relay.getJobs(sessionId) : [];
    },
    // 会话日志导出（session.export 是 no-envelope GET，返回纯文本日志；限制前 500KB 供手机查看）
    async exportSessionLog(sessionId) {
      const sid = String(sessionId || '').trim();
      if (!sid) return { ok: false, code: 'bad-request', error: 'sessionId 不能为空' };
      try {
        const resp = await fetch(WEB_API_BASE + '/api/session.export?sessionId=' + encodeURIComponent(sid));
        if (!resp.ok) return { ok: false, code: 'backend-unavailable', error: 'session.export HTTP ' + resp.status };
        const text = await resp.text();
        return { ok: true, size: text.length, truncated: text.length > 500000, content: text.slice(0, 500000) };
      } catch (e) { return { ok: false, code: 'backend-unavailable', error: 'session.export 失败: ' + String(e) }; }
    },
    // 子代理 prompt（subagent.prompt：给子代理发消息，mode=continuable）
    async subagentPrompt({ parentSessionId, childSessionId, text } = {}) {
      const p = String(parentSessionId || '').trim(), c = String(childSessionId || '').trim(), t = String(text || '').trim();
      if (!p || !c) return { ok: false, code: 'bad-request', error: 'parentSessionId/childSessionId 必填' };
      if (!t) return { ok: false, code: 'bad-request', error: 'text 必填' };
      try {
        const value = await fetchRpc('subagent.prompt', { parentSessionId: p, childSessionId: c, mode: 'continuable', content: [{ type: 'text', text: t }] });
        return { ok: true, value };
      } catch (e) { return { ok: false, code: 'backend-unavailable', error: 'subagent.prompt 失败: ' + String(e) }; }
    },
    // 子代理 interrupt（subagent.interrupt：打断子代理）
    async subagentInterrupt({ parentSessionId, childSessionId } = {}) {
      const p = String(parentSessionId || '').trim(), c = String(childSessionId || '').trim();
      if (!p || !c) return { ok: false, code: 'bad-request', error: 'parentSessionId/childSessionId 必填' };
      try {
        const value = await fetchRpc('subagent.interrupt', { parentSessionId: p, childSessionId: c, mode: 'continuable' });
        return { ok: true, value };
      } catch (e) { return { ok: false, code: 'backend-unavailable', error: 'subagent.interrupt 失败: ' + String(e) }; }
    },
    // GET /api/dsh-models?sessionId=：转发 session.models（当前模型 + 可选模型分组）
    // GET /api/dsh-settings：settings.describe（读取 DSH 设置树，返回关键命名空间）
    async describeSettings() {
      try {
        const value = await fetchRpc('settings.describe', {});
        const namespaces = (value && value.namespaces) || [];
        const pick = ['ui-conversation', 'locale', 'permission', 'ui-theme', 'llm-pi-ai', 'agent-default-model', 'agent-presets', 'web-search-deepseek'];
        const slim = namespaces.filter((n) => pick.includes(n.ns)).map((n) => ({ ns: n.ns, value: n.value || {}, user: n.user || null, revision: n.revision }));
        return { ok: true, writable: !!(value && value.writable), namespaces: slim };
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: 'settings.describe 失败: ' + String(e) };
      }
    },
    // POST /api/dsh-settings {ns, ops, expectedRevision}：settings.mutate（写设置，对标 DSH 桌面设置面板）
    async mutateSettings({ ns, ops, expectedRevision } = {}) {
      const n = String(ns || '').trim();
      if (!n) return { ok: false, code: 'bad-request', error: 'ns 必填' };
      if (!Array.isArray(ops) || !ops.length) return { ok: false, code: 'bad-request', error: 'ops 必填' };
      const doMutate = async (rev) => fetchRpc('settings.mutate', { ns: n, ops, expectedRevision: Number(rev) || 0 });
      try {
        const value = await doMutate(expectedRevision);
        return { ok: true, ns: value && value.ns, result: value };
      } catch (e) {
        // settings-conflict：revision 过期（被其他端改过）→ 重新读取后带新 revision 重试一次
        const msg = String(e);
        if (msg.includes('settings-conflict') || msg.includes('changed since it was read')) {
          try {
            const desc = await fetchRpc('settings.describe', {});
            const nsInfo = ((desc && desc.namespaces) || []).find((x) => x.ns === n);
            const rev = nsInfo && typeof nsInfo.revision === 'number' ? nsInfo.revision : 0;
            const value2 = await doMutate(rev);
            return { ok: true, ns: value2 && value2.ns, result: value2, retried: true };
          } catch (e2) {
            return { ok: false, code: 'backend-unavailable', error: 'settings.mutate 失败: ' + String(e2) };
          }
        }
        return { ok: false, code: 'backend-unavailable', error: 'settings.mutate 失败: ' + msg };
      }
    },
    // POST /api/dsh-credentials {action:'set'|'unset', ref, value?}：DSH 凭据（API 密钥），对标桌面设置面板
    async credentialsSet({ ref, value } = {}) {
      const r = String(ref || '').trim();
      if (!r) return { ok: false, code: 'bad-request', error: 'ref 必填' };
      if (!value) return { ok: false, code: 'bad-request', error: 'value 必填' };
      try {
        await fetchRpc('credentials.set', { ref: r, value: String(value) });
        return { ok: true };
      } catch (e) { return { ok: false, code: 'backend-unavailable', error: 'credentials.set 失败: ' + String(e) }; }
    },
    async credentialsUnset({ ref } = {}) {
      const r = String(ref || '').trim();
      if (!r) return { ok: false, code: 'bad-request', error: 'ref 必填' };
      try {
        await fetchRpc('credentials.unset', { ref: r });
        return { ok: true };
      } catch (e) { return { ok: false, code: 'backend-unavailable', error: 'credentials.unset 失败: ' + String(e) }; }
    },
    async getSessionModels(sessionId) {
      const sid = String(sessionId || '').trim();
      if (!sid) return { ok: false, code: 'bad-request', error: 'sessionId 不能为空' };
      try {
        const value = await fetchRpc('session.models', { sessionId: sid });
        return { ok: true, current: value && value.current, routable: !!(value && value.routable), groups: (value && value.groups) || [], failures: (value && value.failures) || [] };
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: 'session.models 失败: ' + String(e) };
      }
    },
    // POST /api/dsh-models {sessionId, provider, model, reasoningEffort?}：切换会话模型
    async selectSessionModel({ sessionId, provider, model, reasoningEffort } = {}) {
      const sid = String(sessionId || '').trim();
      if (!sid) return { ok: false, code: 'bad-request', error: 'sessionId 不能为空' };
      if (!provider || !model) return { ok: false, code: 'bad-request', error: 'provider/model 必填' };
      const payload = { sessionId: sid, provider: String(provider), model: String(model) };
      if (reasoningEffort) payload.reasoningEffort = String(reasoningEffort);
      try {
        const value = await fetchRpc('session.selectModel', payload);
        return { ok: true, selected: value && value.selected };
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: 'session.selectModel 失败: ' + String(e) };
      }
    },
    // ---- Agent 预设（模式）：
    async listAgentPresets() {
      try {
        const value = await fetchRpc('agentPreset.list', {});
        return { ok: true, presets: (value && value.presets) || [], authorable: !!(value && value.authorable) };
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: 'agentPreset.list 失败: ' + String(e) };
      }
    },
    // POST /api/dsh-presets {sessionId, agentPreset}：agentPreset.select 切换模式
    async selectAgentPreset({ sessionId, agentPreset } = {}) {
      const sid = String(sessionId || '').trim();
      const pre = String(agentPreset || '').trim();
      if (!sid) return { ok: false, code: 'bad-request', error: 'sessionId 不能为空' };
      if (!pre) return { ok: false, code: 'bad-request', error: 'agentPreset 不能为空' };
      try {
        const value = await fetchRpc('agentPreset.select', { sessionId: sid, agentPreset: pre });
        return { ok: true, agentPreset: (value && value.agentPreset) || pre };
      } catch (e) {
        return { ok: false, code: 'backend-unavailable', error: 'agentPreset.select 失败: ' + String(e) };
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
      if (!relayInstance) {
        relayInstance = createApprovalRelay({
          onNotify: pushNotifier ? pushNotifier.notify : undefined,
        });
      }
      return relayInstance;
    },
  });
  // 推送通知（web-push）：由 agent.mjs 注入 pushNotifier = {notify(payload)}（审批/提问/任务完成触发）
  let pushNotifier = null;
  executor.setPushNotifier = function (n) { pushNotifier = n; };
  // 任务完成推送（continueSession 结束时调用）
  function notifyTaskDone(sessionId, ok, summary) {
    if (!pushNotifier) return;
    try {
      pushNotifier.notify({ kind: 'task-done', sessionId: String(sessionId || ''), ok: !!ok, summary: String(summary || '').slice(0, 120) });
    } catch { /* 通知失败不阻断 */ }
  }
  executor.notifyTaskDone = notifyTaskDone;
  executor.runCodex = runCodex;
  executor.routeTask = routeTask;
  executor.startCodex = startCodex;
  executor.getCodexTask = getCodexTask;
  executor.listEngines = listEngines;
  executor.runClaude = runClaude;
  executor.recordTask = recordTask;
  executor.getTaskHistory = getTaskHistory;
  return executor;
}

// ============ 多 Agent 路由：复杂代码任务 → Codex；review/其他 → DSH ============
// 供 transport 的 POST /api/route-task 使用（手机端发任务时自动分派执行引擎）。
const CODEX_TIMEOUT_MS = 10 * 60 * 1000; // Codex 复杂任务最长 10 分钟

// 复杂代码任务 → Codex CLI headless（codex exec --dangerously-bypass-approvals-and-sandbox -C <cwd> <prompt>）
// 返回 {ok, exitCode, stdout, stderr}；超时/启动失败 → {ok:false, error}
async function runCodex(cwd, prompt, timeoutMs = CODEX_TIMEOUT_MS) {
  const dir = String(cwd || ROOT_DIR).trim();
  const line = String(prompt || '').trim();
  if (!line) return { ok: false, error: 'prompt 不能为空' };
  return new Promise((resolve) => {
    let child;
    const bin = resolveCodexJs() || 'codex'; // node 入口 js；找不到则回退 'codex'（报错更清晰）
    try {
      const args = ['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', dir, line];
      child = bin.endsWith('.js')
        ? spawn('node', [bin, ...args], { cwd: dir, windowsHide: true })
        : spawn(bin, args, { cwd: dir, windowsHide: true });
    } catch (e) {
      resolve({ ok: false, error: 'codex 启动失败: ' + e.message });
      return;
    }
    let out = '', err = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: 'codex 运行错误: ' + e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) resolve({ ok: false, error: 'codex 超时（> ' + Math.round(timeoutMs / 1000) + 's）', timedOut: true });
      else resolve({ ok: code === 0, exitCode: code, stdout: out, stderr: err });
    });
  });
}

// 自动路由判定：返回 'codex' | 'dsh'
// 规则（保守，避免误判破坏现有 DSH 工作流）：
//   显式要求用 codex（"用codex / 交给codex / codex 帮我"）→ codex
//   review / 审查 / 检查 类 → dsh（简单 review 用 DSH）
//   其余 → dsh
function routeTask(task) {
  const t = String(task || '').toLowerCase();
  if (/\bcodex\b|用\s*codex|交给\s*codex|让\s*codex/.test(t)) return 'codex';
  return 'dsh';
}

// 异步 Codex 任务：立即返回 taskId，后台跑 codex exec，完成时存结果 + 推送通知（手机端轮询/推送收结果）
const codexTasks = new Map();
let codexSeq = 0;
function startCodex(cwd, task) {
  const id = 'codex-' + (++codexSeq) + '-' + Date.now().toString(36);
  const rec = { id, status: 'running', startedAt: Date.now(), task: String(task || '').slice(0, 200) };
  codexTasks.set(id, rec);
  runCodex(cwd, task).then((res) => {
    rec.status = res.ok ? 'done' : 'error';
    rec.result = res;
    rec.finishedAt = Date.now();
    try {
      if (pushNotifier) pushNotifier.notify({ kind: 'task-done', sessionId: '', ok: !!res.ok, summary: '[Codex] ' + rec.task });
    } catch { /* 通知失败不阻断 */ }
  }).catch((e) => {
    rec.status = 'error'; rec.result = { ok: false, error: String(e) }; rec.finishedAt = Date.now();
  });
  return rec;
}
function getCodexTask(id) {
  const rec = codexTasks.get(String(id || ''));
  if (!rec) return null;
  return { id: rec.id, status: rec.status, task: rec.task, startedAt: rec.startedAt, finishedAt: rec.finishedAt, result: rec.result || null };
}

// 解析 codex CLI 的 node 入口（npm 全局的 codex.cmd wrapper → 实际 bin 脚本），避免 spawn ENOENT
let _codexJs; // undefined = 未解析；null = 解析失败；string = 入口路径
function resolveCodexJs() {
  if (_codexJs !== undefined) return _codexJs;
  _codexJs = null;
  try {
    const where = execFileSync('where', ['codex'], { encoding: 'utf8' });
    const cmdPath = String(where).split(/\r?\n/).map((s) => s.trim()).find((l) => /codex\.cmd$/i.test(l));
    if (cmdPath) {
      const content = readFileSync(cmdPath, 'utf8');
      const m = /"([^"]*node_modules[^"]*)"\s*%/.exec(content);
      const ref = m ? m[1] : null;
      if (ref) _codexJs = ref.replace(/%dp0%/gi, path.dirname(cmdPath));
    }
  } catch { _codexJs = null; }
  return _codexJs;
}

// ============ ① 引擎状态探测（聚合平台：DSH / Codex / Claude / Cline / Gemini） ============
// 探测各 CLI 是否安装 + 版本；DSH 用 3080 探测。返回 {engine: {available, version?, note?}}
function probeCliVersion(cmd, args) {
  try {
    const out = execFileSync(cmd, Array.isArray(args) ? args : ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    return String(out || '').trim().split(/\r?\n/).filter(Boolean).slice(0, 2).join(' · ') || true;
  } catch {
    return null;
  }
}
async function listEngines() {
  // DSH：探 3080
  let dshOk = false;
  try { await fetchRpc('settings.describe', {}); dshOk = true; } catch { dshOk = false; }
  // Codex：解析入口用 node 跑 --version
  let codexV = null;
  try {
    const js = resolveCodexJs();
    const out = js && js.endsWith('.js')
      ? execFileSync(process.execPath, [js, '--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true })
      : execFileSync('codex', ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    codexV = String(out || '').trim().split(/\r?\n/)[0] || true;
  } catch { codexV = null; }
  const claudeV = probeCliVersion('claude', ['--version']);
  const clineV = probeCliVersion('cline', ['--version']);
  const geminiV = probeCliVersion('gemini', ['--version']);
  return {
    engines: [
      { id: 'dsh', available: dshOk, version: dshOk ? 'running' : null, note: dshOk ? '本机 DeepSeek Harness (3080)' : 'DSH 未运行（3080 不可达）' },
      { id: 'codex', available: !!codexV, version: codexV || null, note: codexV ? 'Codex CLI' : '未安装 codex（npm i -g @openai/codex）' },
      { id: 'claude', available: !!claudeV, version: claudeV || null, note: claudeV ? 'Claude Code CLI' : '未安装 claude（npm i -g @anthropic-ai/claude-code）' },
      { id: 'cline', available: !!clineV, version: clineV || null, note: clineV ? 'Cline CLI' : 'Cline 无独立 CLI（VS Code 插件）' },
      { id: 'gemini', available: !!geminiV, version: geminiV || null, note: geminiV ? 'Gemini CLI' : '未安装 gemini' },
    ],
  };
}

// ============ ② Claude Code headless adapter（claude -p "<task>"） ============
// 仅当 claude CLI 已安装才可用；未安装时 route-task 返回"未配置"。
async function runClaude(cwd, task, timeoutMs = 10 * 60 * 1000) {
  const dir = String(cwd || ROOT_DIR).trim();
  const line = String(task || '').trim();
  if (!line) return { ok: false, error: 'task 不能为空' };
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('claude', ['-p', line, '--output-format', 'text'], { cwd: dir, windowsHide: true });
    } catch (e) { resolve({ ok: false, error: 'claude 启动失败: ' + e.message }); return; }
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: 'claude 运行错误（未安装 claude?）: ' + e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, exitCode: code, stdout: out, stderr: err });
    });
  });
}

// ============ ③ 统一任务历史（跨引擎：DSH / Codex / Claude / ...） ============
const taskHistory = [];
function recordTask(engine, task, taskId) {
  taskHistory.unshift({
    engine: String(engine || 'dsh'),
    task: String(task || '').slice(0, 200),
    time: new Date().toISOString(),
    status: 'running',
    taskId: taskId || null,
  });
  if (taskHistory.length > 200) taskHistory.length = 200;
}
function getTaskHistory(engineFilter) {
  return taskHistory
    .filter((t) => !engineFilter || t.engine === engineFilter)
    .map((t) => {
      const r = t.taskId ? (getCodexTask(t.taskId) || null) : null;
      const status = r ? r.status : t.status;
      const resultText = r && r.result ? (r.result.stdout ? String(r.result.stdout).slice(0, 200) : (r.result.error || '')) : '';
      return { engine: t.engine, task: t.task, time: t.time, status, taskId: t.taskId, resultText };
    });
}
