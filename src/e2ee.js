// src/e2ee.js —— 端到端加密（X25519 ECDH + HKDF-SHA256 + AES-256-GCM）
// 对应 docs/architecture/cloud-architecture.md 第 3.3 节（v1 静态共享密钥）。
// 目标：云端只转发密文，无法解密任务内容与结果；明文只存在于手机 App 与电脑 Agent 两端。
//
// X25519 密钥交换用 WebCrypto（crypto.subtle，Node 官方支持 X25519 的 ECDH 方式；
// node:crypto.createECDH / diffieHellman 均不支持 X25519 曲线）。
// 密钥表示为 JWK 的 x（公钥）/d（私钥）base64url 32 字节，天然适合"私钥本机加密存储"。
// AES-256-GCM 与 HKDF 用 node:crypto（不涉及曲线）。

import { randomBytes, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';

export const E2EE_INFO = 'ph-e2ee-v1';
export const AES_KEY_LEN = 32;   // AES-256
export const SALT_LEN = 32;      // HKDF salt
export const NONCE_LEN = 12;     // GCM 推荐 12 字节

/**
 * 生成 X25519 端密钥对（WebCrypto）。
 * @returns {Promise<{ publicKey: string, privateKey: string }>}
 *   publicKey  = JWK.x（base64url，用于共享/上传）
 *   privateKey = 完整私钥 JWK 的 JSON 字符串 `{"x":...,"d":...}`（本机加密存储）
 *   —— X25519 私钥 import 必须同时带 x 与 d，故私钥自包含。
 */
export async function generateKeyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return {
    publicKey: pub.x,
    privateKey: JSON.stringify({ x: priv.x, d: priv.d }),
  };
}

// JWK base64url (x/d) → WebCrypto CryptoKey
async function importPublic(pubB64u) {
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'X25519', x: pubB64u },
    { name: 'X25519' },
    false,
    [],
  );
}
// privateKey 为 generateKeyPair 产物（`{"x":...,"d":...}` JSON）
async function importPrivate(privJson) {
  let jwk;
  try { jwk = JSON.parse(privJson); } catch { jwk = null; }
  if (!jwk || !jwk.x || !jwk.d) throw new Error('非法私钥（需含 x 与 d 的 X25519 JWK）');
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'X25519', x: jwk.x, d: jwk.d },
    { name: 'X25519' },
    false,
    ['deriveBits'],
  );
}

// 标准 HKDF-SHA256：Extract(salt, ikm) → PRK；Expand(PRK, info, len) → OKM
function hkdfSha256(ikm, salt, info, len) {
  const saltBuf = salt && salt.length ? salt : Buffer.alloc(32); // 空 salt 用全零
  const prk = createHmac('sha256', saltBuf).update(ikm).digest();
  const N = Math.ceil(len / 32);
  const blocks = [];
  let prev = Buffer.alloc(0);
  for (let i = 1; i <= N; i++) {
    prev = createHmac('sha256', prk).update(Buffer.concat([prev, info, Buffer.from([i])])).digest();
    blocks.push(prev);
  }
  return Buffer.concat(blocks).slice(0, len);
}

/** 生成可共享的 SDK 随机盐（base64url 32B）；绑定后两端用同一盐独立计算密钥 */
export function generateKeySalt() {
  return randomBytes(SALT_LEN).toString('base64url');
}

/**
 * 派生 AES-256 会话密钥：HKDF-SHA256(ikm=X25519 ECDH(privateKey, peerPublicKey), salt, info)。
 * @param {string} privateKey     本端私钥（base64url JWK d）
 * @param {string} peerPublicKey  对端公钥（base64url JWK x）
 * @param {string} [saltB64u]     HKDF salt（base64url，可选）
 * @param {string} [info]
 * @returns {Promise<Buffer>} 32 字节 AES-256 密钥
 */
export async function deriveSessionKey(privateKey, peerPublicKey, saltB64u, info = E2EE_INFO) {
  const privKey = await importPrivate(privateKey);
  const pubKey = await importPublic(peerPublicKey);
  const bits = await crypto.subtle.deriveBits({ name: 'X25519', public: pubKey }, privKey, 256);
  const shared = Buffer.from(bits);
  const salt = saltB64u ? Buffer.from(saltB64u, 'base64url') : randomBytes(SALT_LEN);
  return hkdfSha256(shared, salt, Buffer.from(info), AES_KEY_LEN);
}

/**
 * 加密一条消息。
 * @param {Buffer} key                32 字节 AES-256 密钥（deriveSessionKey 产物）
 * @param {string|Buffer} plaintext   明文
 * @param {string|Buffer} [aad]       附加认证数据（如 tasks 元数据序列化）
 */
export function encrypt(key, plaintext, aad) {
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64url'),
    nonce: nonce.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  };
}

/**
 * 解密一条消息。
 * @param {Buffer} key
 * @param {{ciphertext, nonce, tag}} box
 * @param {string|Buffer} [aad] 必与加密时一致；不匹配/密文被篡改会认证失败
 * @returns {Buffer|null} 明文；认证失败或结构非法返回 null
 */
export function decrypt(key, box, aad) {
  if (!box || typeof box !== 'object' || !box.ciphertext || !box.nonce || !box.tag) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.nonce, 'base64url'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64url'));
    if (aad !== undefined) decipher.setAAD(Buffer.from(aad));
    return Buffer.concat([decipher.update(Buffer.from(box.ciphertext, 'base64url')), decipher.final()]);
  } catch {
    return null;
  }
}
