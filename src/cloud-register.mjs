// src/cloud-register.mjs —— Agent 云端注册 + E2EE 密钥就位
// 供 agent.mjs 在 cloud/both 模式启动时调用：
//   1. 确保 config.cloud.e2ee.privateKey 存在（无则用 e2ee-web 生成 P-256 密钥对并持久化到 config.json）
//   2. 用 REST POST <cloud>/v1/devices/register 上报设备信息 + 公钥，拿配对码打印给用户
// REST 地址由 WS 地址推导：wss://HOST/v1/agent/ws → https://HOST（/v1/*）；本机 http 同理。
import { readFileSync, writeFileSync } from 'node:fs';
import { generateKeyPair } from './e2ee-web.js';

// 从 ws/wss 地址推导 REST base（去掉 /v1/agent/ws 等路径，保留 host）
export function restBaseFromWs(wsUrl) {
  const u = String(wsUrl || '');
  if (!u) return null;
  let base = u;
  // 去尾部路径（保留 origin）
  base = base.replace(/^wss:\/\//i, 'https://');
  base = base.replace(/^ws:\/\//i, 'http://');
  // 截断到 host 结尾（保留到端口）
  const m = /^(https?:\/\/[^/?#]+)/i.exec(base);
  return m ? m[1] : null;
}

/**
 * 确保 E2EE 密钥就位：存在则返回 {privateKey, publicKey}，否则生成并持久化。
 * @param {object} config   内存 config（会读取 config.cloud.e2ee.privateKey）
 * @param {string} configPath config.json 绝对路径（用于持久化新密钥）
 */
export async function ensureE2EEKey(config, configPath) {
  const e = config.cloud && config.cloud.e2ee;
  if (e && e.privateKey) {
    return { privateKey: e.privateKey, publicKey: derivePubFromPriv(e.privateKey) ?? null, fresh: false };
  }
  const pair = await generateKeyPair();
  const cloud = config.cloud || (config.cloud = {});
  cloud.e2ee = { privateKey: pair.privateKey };
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) { /* 持久化失败不阻塞运行 */ }
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, fresh: true };
}

// 从私钥 JWK 导出公钥（JWK 含 x/y；直接取出去 d）
function derivePubFromPriv(privJwkStr) {
  try {
    const j = JSON.parse(privJwkStr);
    if (j && j.kty === 'EC' && j.crv === 'P-256' && j.x && j.y) {
      return JSON.stringify({ kty: 'EC', crv: 'P-256', x: j.x, y: j.y, key_ops: [], ext: true });
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * 上报设备（REST register），返回配对码或 null。
 * @param {object} opts { host, agentId, publicKey, name?, os?, token? }
 */
export async function registerDevice(opts) {
  const { host, agentId, publicKey, name, os, token } = opts;
  if (!host || !agentId) throw new Error('缺少 host/agentId');
  // tokenHash：sha256(agent LAN token)，云端据此把手机 /api/* 中继到本设备
  let tokenHash = null;
  if (token) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token)));
      tokenHash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch { /* tokenHash 可选 */ }
  }
  const resp = await fetch(host + '/v1/devices/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId, name: name || agentId, os, publicKey, tokenHash }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error('注册失败: ' + (data.error || ('HTTP ' + resp.status)));
  return data.pairCode || null;
}

export function loadConfigFile(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}
