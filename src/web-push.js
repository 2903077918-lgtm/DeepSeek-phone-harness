// src/web-push.js —— Web Push 发送器（零依赖：Node 内置 crypto 手写 VAPID + RFC 8291 aes128gcm）
// 手机浏览器 PushManager 订阅 → agent 存订阅 → 审批/提问/任务完成时发 Web Push（免费，无需 APNs/FCM 账号）
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PUSH_SUBJECT = 'mailto:ph@relay.axyntara.cn';

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function unb64url(s) { return Buffer.from(String(s || ''), 'base64url'); }

// ---- VAPID 密钥对（P-256 JWK，持久化到 config.json 的 push 节）----
export function ensureVapidKeys(config, configPath) {
  const p = config.push;
  if (p && p.vapidPrivate && p.vapidPublic) return p;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'jwk' },
    privateKeyEncoding: { type: 'pkcs8', format: 'jwk' },
  });
  const push = { vapidPublic: publicKey, vapidPrivate: privateKey };
  config.push = push;
  try { writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8'); } catch { /* 持久化失败不阻塞 */ }
  return push;
}

// JWK → 原始 65 字节非压缩公钥（0x04 || x || y）
function rawPublicFromJwk(jwk) {
  const x = unb64url(jwk.x); const y = unb64url(jwk.y);
  return Buffer.concat([Buffer.from([4]), x, y]);
}
// JWK → Node KeyObject（私钥签名用）
function privateKeyObject(jwk) {
  return crypto.createPrivateKey({ key: jwk, format: 'jwk' });
}

// ECDSA DER 签名 → 原始 R||S（JWT 需要）
function derToRaw(dersig, size) {
  let r = dersig.subarray(4, 4 + dersig[3]);
  let s = dersig.subarray(6 + dersig[3], 6 + dersig[3] + dersig[5 + dersig[3]]);
  if (r[0] === 0 && r.length > size / 8) r = r.subarray(1);
  if (s[0] === 0 && s.length > size / 8) s = s.subarray(1);
  while (r.length < size / 8) r = Buffer.concat([Buffer.alloc(1), r]);
  while (s.length < size / 8) s = Buffer.concat([Buffer.alloc(1), s]);
  return Buffer.concat([r, s]);
}

// VAPID JWT：header ES256 + claims(aud=endpoint origin, exp) 签名
function vapidAuthorization(endpoint, vapidJwk) {
  const aud = new URL(endpoint).origin;
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(Buffer.from(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: PUSH_SUBJECT })));
  const signingInput = header + '.' + claims;
  const sig = crypto.sign('SHA256', Buffer.from(signingInput), privateKeyObject(vapidJwk));
  const raw = derToRaw(sig, 256);
  return 'vapid t=' + (header + '.' + claims + '.' + b64url(raw)) + ', k=' + b64url(rawPublicFromJwk(vapidJwk));
}

// RFC 8291 aes128gcm：ECDH 共享密钥 → HKDF → AES-256-GCM，附记录头
function encryptPayload(clientPubRaw, authSecret, plaintext) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const ephPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(clientPubRaw);
  const salt = crypto.randomBytes(16);
  // HKDF-Extract（32 字节零 salt）→ Expand 出 CEK/NONCE
  const prk = crypto.hkdfSync('sha256', shared, Buffer.alloc(32), '', 32);
  const cek = crypto.hkdfSync('sha256', prk, Buffer.from('Content-Encoding: aes128gcm\0'), '', 16);
  const nonce = crypto.hkdfSync('sha256', prk, Buffer.from('Content-Encoding: nonce\0'), '', 12);
  // 记录头（RFC 8188）：salt(16) + rs(4) + idlen(1) + keyid(65)
  const rs = 4096;
  const header = Buffer.concat([
    salt,
    Buffer.from([(rs >> 24) & 0xff, (rs >> 16) & 0xff, (rs >> 8) & 0xff, rs & 0xff]),
    Buffer.from([ephPub.length]),
    ephPub,
  ]);
  const cipher = crypto.createCipheriv('aes-256-gcm', cek, nonce, { authTagLength: 16 });
  cipher.setAAD(header);
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([header, enc, cipher.getAuthTag()]);
}

// 发送一条 Web Push。subscription = {endpoint, keys:{p256dh, auth}}
export async function sendPush(subscription, vapidJwk, payload) {
  const { endpoint, keys } = subscription || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) return { ok: false, error: '订阅无效' };
  const body = encryptPayload(unb64url(keys.p256dh), unb64url(keys.auth), JSON.stringify(payload));
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'content-encoding': 'aes128gcm',
      ttl: '60',
      authorization: vapidAuthorization(endpoint, vapidJwk),
    },
    body,
  });
  return { ok: resp.ok, status: resp.status };
}

// ---- 订阅存储（本地文件，手机浏览器注册的 PushSubscription）----
export function createPushStore(filePath) {
  const subs = new Map(); // id -> {endpoint, keys, deviceLabel, at}
  function load() {
    try {
      if (!existsSync(filePath)) return;
      const arr = JSON.parse(readFileSync(filePath, 'utf8'));
      if (Array.isArray(arr)) arr.forEach((s) => { if (s && s.id) subs.set(s.id, s); });
    } catch { /* 损坏忽略 */ }
  }
  function save() {
    try { writeFileSync(filePath, JSON.stringify([...subs.values()], null, 2), 'utf8'); } catch { /* 写失败忽略 */ }
  }
  function register(sub, label) {
    const endpoint = String((sub && sub.endpoint) || '').trim();
    if (!endpoint) return { ok: false, error: 'endpoint 必填' };
    // 同 endpoint 幂等
    let id = null;
    for (const [k, v] of subs) if (v.endpoint === endpoint) { id = k; break; }
    if (!id) { id = 'push-' + crypto.randomBytes(4).toString('hex'); }
    subs.set(id, { id, endpoint, keys: (sub && sub.keys) || {}, deviceLabel: label || '手机', at: new Date().toISOString() });
    save();
    return { ok: true, id };
  }
  function list() {
    return [...subs.values()].map((s) => ({ id: s.id, deviceLabel: s.deviceLabel, at: s.at }));
  }
  function remove(id) { subs.delete(id); save(); }
  async function notifyAll(vapidJwk, payload) {
    const results = [];
    for (const s of subs.values()) {
      try {
        const r = await sendPush(s, vapidJwk, payload);
        if (r.status === 404 || r.status === 410) subs.delete(s.id); // 订阅失效清理
        results.push({ id: s.id, ok: r.ok, status: r.status });
      } catch (e) { results.push({ id: s.id, ok: false, error: String(e) }); }
    }
    save();
    return results;
  }
  load();
  return { register, list, remove, notifyAll, send: (sub, vapidJwk, payload) => sendPush(sub, vapidJwk, payload) };
}
