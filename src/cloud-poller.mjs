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
  } = opts;
  const cloud = config.cloud || {};
  const agentPrivate = cloud.e2ee && cloud.e2ee.privateKey;
  const agentId = cloud.deviceId;
  const restBase = restBaseFromWs(cloud.url);
  if (!agentId || !restBase) throw new Error('需 config.cloud.deviceId 与 url(可推导REST)');

  let timer = null;
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

  function start() { if (timer) return; pollOnce(); timer = setInterval(pollOnce, pollIntervalMs); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  return { start, stop, pollOnce };
}
