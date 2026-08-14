// src/e2ee-web.js —— 跨端 E2EE（P-256 ECDH + HKDF-SHA256 + AES-256-GCM），纯 WebCrypto
// 同时运行于 Node(≥22) 与浏览器：Node 和浏览器的 crypto.subtle 都支持 P-256 ECDH / HKDF / AES-GCM，
// 因此手机(浏览器)与电脑 Agent(Node) 可共用本模块派生出**相同**的会话密钥，云端只见密文+公钥。
// 无 node:crypto / 第三方依赖。
//
// 密钥模型（端到端：云端不可读任务内容）：
//   每端生成 P-256 密钥对；交换公钥(经 TLS)；各端 ECDH(本端私钥, 对端公钥) 得共享秘密；
//   key = HKDF-SHA256(shared, salt, info='ph-e2ee-v2') → 32B AES-256；AES-GCM 加解密。
//   共享密钥只存在于两端，云端永远拿不到（即使拿到公钥也无法解密）。

export const E2EE_INFO = 'ph-e2ee-v2';
export const E2EE_CURVE = 'P-256';
export const AES_KEY_LEN = 256;   // bits
export const NONCE_LEN = 12;      // AES-GCM iv

/** 生成 P-256 端密钥对。返回 { publicKey, privateKey }（均为完整 JWK JSON 字符串） */
export async function generateKeyPair() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: JSON.stringify(pub), privateKey: JSON.stringify(priv) };
}

function parseJwk(s, needPrivate) {
  let j; try { j = JSON.parse(s); } catch { throw new Error('非法密钥（非 JWK JSON）'); }
  if (!j || j.kty !== 'EC' || j.crv !== 'P-256' || !j.x || !j.y) throw new Error('非法密钥（需 EC P-256 且含 x/y）');
  if (needPrivate && !j.d) throw new Error('非法私钥（缺 d）');
  return j;
}
async function importPeerPublic(pubJwk) {
  const j = parseJwk(pubJwk, false);
  return crypto.subtle.importKey('jwk', { kty:'EC', crv:'P-256', x:j.x, y:j.y }, { name:'ECDH', namedCurve:'P-256' }, false, []);
}
async function importOwnPrivate(privJwk) {
  const j = parseJwk(privJwk, true);
  return crypto.subtle.importKey('jwk', { kty:'EC', crv:'P-256', x:j.x, y:j.y, d:j.d }, { name:'ECDH', namedCurve:'P-256' }, false, ['deriveBits']);
}

/** 生成可共享的随机 32B salt（base64url）；两端用同一 salt 独立计算密钥 */
export function generateKeySalt() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return bytesToB64u(b);
}
function bytesToB64u(u8) { return btoa(String.fromCharCode(...u8)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function b64uToBytes(s) { s = s.replace(/-/g,'+').replace(/_/g,'/'); while (s.length%4) s+='='; const bin=atob(s); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); return u; }
function strToBytes(s){ return new TextEncoder().encode(s); }
function bytesToHex(u){ return Array.from(u).map(b=>b.toString(16).padStart(2,'0')).join(''); }

/**
 * 派生 AES-256-GCM 会话密钥（返回可加密/解密的 CryptoKey）。
 * @param {string} privateJwk     本端私钥（generateKeyPair().privateKey）
 * @param {string} peerPubJwk     对端公钥（generateKeyPair().publicKey）
 * @param {string} [saltB64u]     HKDF salt
 * @param {string} [info]
 */
export async function deriveSessionKey(privateJwk, peerPubJwk, saltB64u, info = E2EE_INFO) {
  const priv = await importOwnPrivate(privateJwk);
  const pub = await importPeerPublic(peerPubJwk);
  const shared = await crypto.subtle.deriveBits({ name:'ECDH', public: pub }, priv, 256);
  const salt = saltB64u ? b64uToBytes(saltB64u) : new Uint8Array(32);
  const infoBytes = strToBytes(info);
  const base = await crypto.subtle.importKey('raw', shared, { name:'HKDF' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'HKDF', salt, info: infoBytes, hash:'SHA-256' },
    base, { name:'AES-GCM', length: AES_KEY_LEN }, false, ['encrypt','decrypt']);
}

/** 派生可回显/校验的密钥指纹（hex 摘要，用于配对时用户比对，防 MITM） */
export async function deriveKeyFingerprint(privateJwk, peerPubJwk, saltB64u, info = E2EE_INFO) {
  const priv = await importOwnPrivate(privateJwk);
  const pub = await importPeerPublic(peerPubJwk);
  const shared = await crypto.subtle.deriveBits({ name:'ECDH', public: pub }, priv, 256);
  const salt = saltB64u ? b64uToBytes(saltB64u) : new Uint8Array(32);
  const base = await crypto.subtle.importKey('raw', shared, { name:'HKDF' }, false, ['deriveKey']);
  // 指纹用可导出的 AES key（内容与 deriveSessionKey 一致，仅 extractable 不同）
  const k = await crypto.subtle.deriveKey(
    { name:'HKDF', salt, info: strToBytes(info), hash:'SHA-256' },
    base, { name:'AES-GCM', length: AES_KEY_LEN }, true, ['encrypt','decrypt']);
  const raw = await crypto.subtle.exportKey('raw', k);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)).slice(0, 16));
}

/** AES-256-GCM 加密。plaintext 为字符串/Bytes；返回 {ciphertext, iv, tag}（均 base64url） */
export async function encrypt(key, plaintext, aad) {
  const data = typeof plaintext === 'string' ? strToBytes(plaintext) : plaintext;
  const iv = new Uint8Array(crypto.getRandomValues(new Uint8Array(NONCE_LEN)));
  const aadBytes = aad!==undefined ? (typeof aad==='string'?strToBytes(aad):aad) : undefined;
  const buf = await crypto.subtle.encrypt({ name:'AES-GCM', iv, additionalData: aadBytes }, key, data);
  const full = new Uint8Array(buf);
  const tag = full.slice(full.length-16);          // GCM 尾 16B 为 auth tag
  const cipher = full.slice(0, full.length-16);
  return { ciphertext: bytesToB64u(cipher), iv: bytesToB64u(iv), tag: bytesToB64u(tag) };
}

/** AES-256-GCM 解密。返回 Uint8Array，失败/篡改返回 null */
export async function decrypt(key, box, aad) {
  if (!box || !box.ciphertext || !box.iv || !box.tag) return null;
  try {
    const full = new Uint8Array(b64uToBytes(box.ciphertext).length + 16);
    full.set(b64uToBytes(box.ciphertext), 0);
    full.set(b64uToBytes(box.tag), full.length-16);
    const aadBytes = aad!==undefined ? (typeof aad==='string'?strToBytes(aad):aad) : undefined;
    return new Uint8Array(await crypto.subtle.decrypt(
      { name:'AES-GCM', iv: b64uToBytes(box.iv), additionalData: aadBytes }, key, full));
  } catch { return null; }
}
