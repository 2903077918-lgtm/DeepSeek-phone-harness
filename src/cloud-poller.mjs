// src/cloud-poller.mjs —— Agent 云端轮询客户端（Vercel/无长连接友好）
// 替代 WebSocket：定时 GET /v1/poll 拉这台设备的任务，逐条 E2EE 解密→executor 执行→加密结果回传。
// E2EE 约定与 cloud-service 一致：prompt AAD='ph-task'，结果 AAD=taskId，salt/senderKey 随任务下发。
import { deriveSessionKey, encrypt, decrypt } from './e2ee-web.js';
import { restBaseFromWs } from './cloud-register.mjs';
import { detectRiskLevel } from './guard.js';

const PROMPT_AAD = 'ph-task';

export function createCloudPoller(opts = {}) {
  const {
    config = {},
    executor,
    pollIntervalMs = 3000,
    log = console,
    fetchImpl = fetch,
    lanBase = 'http://127.0.0.1:8788',   // 云端 /api/* 中继 → 回环到本地 LAN 传输层
    lanToken = '',
  } = opts;
  const cloud = config.cloud || {};
  const agentPrivate = cloud.e2ee && cloud.e2ee.privateKey;
  const agentId = cloud.deviceId;
  const restBase = restBaseFromWs(cloud.url);
  if (!agentId || !restBase) throw new Error('需 config.cloud.deviceId 与 url(可推导REST)');

  let timer = null;
  let relayTimer = null;
  let polling = false;
  let running = false;

  async function http(path, opts2 = {}) {
    const r = await fetchImpl(restBase + path, {
      method: opts2.method || 'GET',
      headers: { 'content-type': 'application/json' },
      body: opts2.body,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data && data.error) || ('HTTP ' + r.status));
    return data;
  }

  // 任务级会话密钥（与手机侧一致：Agent私钥+senderKey+salt）
  async function taskKey(taskId, senderKey, salt) {
    if (!agentPrivate || !senderKey) return null;
    return deriveSessionKey(agentPrivate, senderKey, salt);
  }
  async function decryptPrompt(taskId, payload) {
    // 任务数据字段为下划线风格（prompt_cipher/sender_key/salt），与后端 tasks 表一致
    const key = await taskKey(taskId, payload.sender_key, payload.salt);
    if (!key || !payload.prompt_cipher) { log.warn('[poll] 任务 ' + taskId + ' 无密钥/无密文，跳过'); return null; }
    const p = await decrypt(key, payload.prompt_cipher, PROMPT_AAD);
    return p ? new TextDecoder().decode(p) : null;
  }
  async function encryptResult(taskId, result) {
    const payload = null; // 结果加密需 senderKey/salt，需从任务里取；此处由调用方传
    void payload;
    return null; // 占位，实际在 processTask 里用该任务密钥
  }

  async function processTask(task) {
    if (!task || !task.id || !task.prompt_cipher) return;
    const key = await taskKey(task.id, task.sender_key, task.salt);
    if (!key) { log.warn('[poll] 任务 ' + task.id + ' 无密钥，跳过'); return; }
    const prompt = await decryptPrompt(task.id, task);
    if (!prompt) { log.warn('[poll] 任务 ' + task.id + ' 解密失败'); return; }
    log.info('[poll] 执行任务 ' + task.id);
    const risk = detectRiskLevel(prompt);
    let result;
    try { result = await executor.run(prompt, {}); }
    catch (e) { result = { ok: false, exitCode: -1, stdout: '', stderr: String(e), elapsedMs: 0 }; }
    const box = await encrypt(key, JSON.stringify({ ok: !!result.ok, stdout: result.stdout || '', stderr: result.stderr || '', exitCode: result.exitCode, elapsedMs: result.elapsedMs }), String(task.id));
    await http('/v1/agent/tasks/' + encodeURIComponent(task.id) + '/result', {
      method: 'POST', body: JSON.stringify({ status: result.ok ? 'succeeded' : 'failed', result_cipher: box, elapsedMs: result.elapsedMs, exitCode: result.exitCode }),
    });
    log.info('[poll] 任务 ' + task.id + ' 完成(' + (result.ok ? 'ok':'fail') + ')');
  }

  // 云端 /api/* 中继：手机经云端调本地 LAN 传输层，回环执行（20s 超时防 SSE 长连接挂死轮询）
  async function processRelay(req) {
    if (!req || !req.id || !req.path) return;
    const q = req.query ? (req.query.startsWith('?') ? req.query : '?' + req.query) : '';
    const url = lanBase + req.path + q;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20000);
    try {
      const r = await fetchImpl(url, {
        method: req.method || 'GET',
        headers: { authorization: 'Bearer ' + lanToken, 'content-type': 'application/json' },
        body: (req.method === 'POST' && req.body) ? req.body : undefined,
        signal: ac.signal,
      });
      const text = await r.text();
      await http('/v1/relay/requests/' + encodeURIComponent(req.id) + '/result', {
        method: 'POST', body: JSON.stringify({ status: 'done', resultStatus: r.status, resultBody: text }),
      });
      log.info('[poll] relay ' + req.method + ' ' + req.path + ' → ' + r.status);
    } catch (e) {
      try {
        await http('/v1/relay/requests/' + encodeURIComponent(req.id) + '/result', {
          method: 'POST', body: JSON.stringify({ status: 'error', resultStatus: 502, resultBody: JSON.stringify({ error: 'relay 执行失败: ' + String(e) }) }),
        });
      } catch (e2) { log.error('[poll] relay 回传失败: ' + e2.message); }
    } finally { clearTimeout(t); }
  }

  // 云端 /api/* 中继快轮询：单独 1s 一次（比任务轮询快，降低手机云端延迟）
  async function relayOnce() {
    if (polling || running) return;
    polling = true;
    try {
      const rr = await http('/v1/relay/requests?deviceId=' + encodeURIComponent(agentId));
      const items = (rr && rr.items) || [];
      for (const rq of items) {
        running = true;
        try { await processRelay(rq); } catch (e) { log.error('[poll] relay 处理失败: ' + e.message); }
        finally { running = false; }
      }
    } catch (e) { /* 表未就绪/网络抖动忽略 */ }
    finally { polling = false; }
  }

  async function pollOnce() {
    if (polling || running) return;
    polling = true;
    try {
      const d = await http('/v1/poll?deviceId=' + encodeURIComponent(agentId));
      if (d.ok === false) { /* 未注册等，忽略 */ return; }
      if (d.device && d.device.killed) { log.warn('[poll] 设备已 kill，暂停'); return; }
      const queued = (d.tasks || []).filter((t) => t.status === 'queued');
      for (const task of queued) {
        running = true;
        try { await processTask(task); } catch (e) { log.error('[poll] 任务处理失败: ' + e.message); }
        finally { running = false; }
      }
    } catch (e) {
      log.error('[poll] 轮询异常: ' + (e && e.message ? e.message : String(e)));
    }
    finally { polling = false; }
  }

  function start() {
    if (timer) return;
    pollOnce();
    timer = setInterval(pollOnce, pollIntervalMs);
    relayOnce();
    relayTimer = setInterval(relayOnce, 1000); // relay 快轮询
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (relayTimer) { clearInterval(relayTimer); relayTimer = null; }
  }

  return { start, stop, pollOnce, relayOnce };
}
