// src/cloud-service.mjs —— Agent 云端服务接线器：桥接 cloud transport 与 executor
// 对应架构文档第 5 章"执行与传输解耦 + 新增 cloud 通道"。收云端下行指令 → 经 executor 执行 →
// 结果回传；集成 e2ee（解密任务/加密结果）、guard（风险分级+确认）、audit（日志）。
//
// 设计为使待测：transport/executor/log 均可注入，本地 mock 即可验证消息流转（无需真实云端）。
// 本模块不发起连接、不持密钥明文；密钥与设备凭据由调用方(config)注入。

import { MSG_TYPES, validateEnvelope } from './protocol.js';
import { decrypt, encrypt, deriveSessionKey } from './e2ee.js';
import { detectRiskLevel, summarizeRisk, requiresConfirm, RISK_HIGH } from './guard.js';
import { createAuditLog } from './audit.js';

export function createCloudService(opts = {}) {
  const {
    transport,          // cloud transport（createCloudTransport 产物），需 on()/sendResult/sendStatus/sendAck/sendRaw
    executor,           // executor（.run(task, {sessionId}) → result）
    config = {},        // {cloud:{url,deviceToken,e2ee:{privateKey,peerPublicKey,salt}}}
    confirmPolicy = 'high',
    log = console,
    auditFile = null,   // 本地审计路径（null 则不落盘）
    deriveKey = deriveSessionKey, // 便于测试注入
  } = opts;

  const audit = auditFile ? createAuditLog(auditFile) : null;

  // 派生共享密钥（手机 E2EE 公钥 + Agent 私钥），供加解密任务内容
  let sessionKey = null;
  async function resolveSessionKey() {
    if (sessionKey) return sessionKey;
    const e = config && config.cloud && config.cloud.e2ee;
    if (!e || !e.privateKey || !e.peerPublicKey) return null; // 未配对 → 走明文路径
    sessionKey = await deriveKey(e.privateKey, e.peerPublicKey, e.salt);
    return sessionKey;
  }

  // 解密任务 prompt：优先 E2EE 密文，其次明文（未配对/明文 task.submit）
  async function promptOf(payload) {
    const key = await resolveSessionKey();
    if (key && payload && typeof payload.promptCipher === 'object') {
      const p = decrypt(key, payload.promptCipher, String(payload.taskId || ''));
      if (p) return p.toString('utf8');
    }
    return payload && typeof payload.prompt === 'string' ? payload.prompt : '';
  }

  // 加密任务结果（E2EE）；无密钥时原样回传
  async function resultBox(taskId, result) {
    const key = await resolveSessionKey();
    if (!key) return { ...result };
    const plain = JSON.stringify({ ok: result.ok, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, elapsedMs: result.elapsedMs });
    return { ...result, result_cipher: encrypt(key, plain, String(taskId || '')), e2ee: true };
  }

  // ---- 消息分发：云端 → Agent ----
  async function handleMessage(env) {
    if (!validateEnvelope(env)) return;
    switch (env.type) {
      case MSG_TYPES.TASK_SUBMIT: return handleTaskSubmit(env.payload || {});
      case MSG_TYPES.TASK_CANCEL: return handleTaskCancel(env.payload || {});
      case MSG_TYPES.CONTROL_KILL: return handleKill(env.payload || {});
      case MSG_TYPES.BIND_REVOKED: return handleBindRevoked();
      default: break; // HELLO/PING/PONG/TASK_ACK 等由传输层处理
    }
    return undefined;
  }

  // ---- TASK_SUBMIT：解密→guard→executor→加密回传 ----
  async function handleTaskSubmit(payload) {
    const taskId = String(payload.taskId || '');
    if (!taskId) { log.error('[cloud] task.submit 缺 taskId'); return; }
    const prompt = await promptOf(payload);
    if (!prompt) {
      transport.sendStatus(taskId, 'failed', { error: '空任务' });
      return;
    }
    log.info('[cloud] 收到任务 ' + taskId);

    // 回执（可靠投递）
    transport.sendAck(taskId);

    // 风险分级 + 确认（骨架：默认 high 级需确认；超时默认拒绝，见 confirmPolicy）
    const riskLevel = detectRiskLevel(prompt);
    const needConfirm = payload.requireConfirm === true || (confirmPolicy === 'always')
      || (confirmPolicy === 'high' && riskLevel === RISK_HIGH);
    audit?.append('task.submit', { taskId, riskLevel, needConfirm });

    if (needConfirm) {
      const confirmed = await requestConfirm({ taskId, prompt, riskLevel });
      if (!confirmed) {
        transport.sendResult(taskId, { ok: false, exitCode: -1, stderr: '[confirm] 被拒绝/超时', elapsedMs: 0, cancelled: true });
        return;
      }
    }

    transport.sendStatus(taskId, 'running', { taskId, riskLevel });
    try {
      const result = await executor.run(prompt, {});
      audit?.append('task.result', { taskId, ok: !!result.ok, backend: result.backend });
      transport.sendResult(taskId, await resultBox(taskId, result));
    } catch (e) {
      audit?.append('task.failed', { taskId, error: String(e) });
      transport.sendResult(taskId, { ok: false, exitCode: -1, stderr: String(e), elapsedMs: 0 });
    }
  }

  // 确认请求（骨架：转成 confirm.request 等待手机 confirm.response；超时默认拒绝）
  function requestConfirm({ taskId, prompt, riskLevel }) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (decided) => { if (settled) return; settled = true; cleanup(); resolve(decided); };
      const cleanup = () => { transport.off('message', onMsg); };

      // 发 confirm.request；等待手机回 confirm.response
      const requestId = 'cfm_' + taskId;
      transport.sendRaw(MSG_TYPES.CONFIRM_REQUEST, {
        requestId, taskId,
        prompt: prompt.slice(0, 200),
        riskSummary: summarizeRisk(prompt),
        riskLevel,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }, false);

      const onMsg = (env) => {
        if (env.type === MSG_TYPES.CONFIRM_RESPONSE
          && env.payload && env.payload.requestId === requestId) {
          finish(env.payload.decision === 'allow');
        }
      };
      transport.on('message', onMsg);

      // 60s 超时默认拒绝（fail-safe）
      setTimeout(() => finish(false), 60000);
    });
  }

  function handleTaskCancel(payload) {
    const taskId = String((payload && payload.taskId) || '');
    log.info('[cloud] 取消任务 ' + taskId);
    if (typeof executor.cancelSession === 'function' && taskId) {
      return executor.cancelSession(taskId);
    }
    return undefined;
  }

  function handleKill() {
    log.warn('[cloud] 收到 control.kill，暂停接单');
    // 骨架：置 kill 标志，由上层停止接收新任务
    return { killed: true };
  }

  function handleBindRevoked() {
    log.warn('[cloud] 收到 bind.revoked，设备被解绑，清空会话密钥');
    sessionKey = null;
    return { revoked: true };
  }

  // 接入 transport 消息流
  transport.on('message', handleMessage);

  return { handleMessage, handleTaskSubmit, resolveSessionKey, promptOf, resultBox };
}
