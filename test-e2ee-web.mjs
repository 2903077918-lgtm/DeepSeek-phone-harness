// test-e2ee-web.mjs —— 跨端 E2EE（e2ee-web.js）一致性测试
// 用同一 WebCrypto 实现分别扮演「手机」与「Agent」两端，验证：
//   ECDH 派生同一 AES 密钥、加密→解密往返、篡改/AAD 不匹配拒绝、密钥指纹可用于比对。
// 因浏览器与 Node 都跑同一份 e2ee-web.js（纯 WebCrypto），此测试即证明浏览器↔Node 可互通。
import {
  generateKeyPair, deriveSessionKey, generateKeySalt, encrypt, decrypt, deriveKeyFingerprint,
} from './src/e2ee-web.js';

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log((cond ? '✅' : '❌'), name, detail ? '| ' + detail : '');
}

// ---- 手机端 + Agent 端各自生成密钥对，交换公钥 ----
const phone = await generateKeyPair();       // 手机
const agent = await generateKeyPair();       // 电脑 Agent
const salt = generateKeySalt();              // 两端共用同一 salt

// 两端独立 ECDH(本端私钥, 对端公钥) → 应得到同一 AES 密钥
const phoneKey = await deriveSessionKey(phone.privateKey, agent.publicKey, salt);
const agentKey = await deriveSessionKey(agent.privateKey, phone.publicKey, salt);

// 无法直接比较 CryptoKey，用指纹/加密结果对比
const fpPhone = await deriveKeyFingerprint(phone.privateKey, agent.publicKey, salt);
const fpAgent = await deriveKeyFingerprint(agent.privateKey, phone.publicKey, salt);
check('两端派生同一密钥（指纹一致）', fpPhone === fpAgent, fpPhone.slice(0,12));

// 手机加密 → Agent 解密
const aad = JSON.stringify({ taskId: 'tsk_e2e', deviceId: 'pc-1' });
const box = await encrypt(phoneKey, '检查 C 盘剩余空间并删除临时文件', aad);
const agentPlain = await decrypt(agentKey, box, aad);
check('手机加密→Agent解密往返', agentPlain && new TextDecoder().decode(agentPlain) === '检查 C 盘剩余空间并删除临时文件');

// Agent 加密结果 → 手机解密
const resBox = await encrypt(agentKey, 'C 盘剩余 128GB', aad);
const phonePlain = await decrypt(phoneKey, resBox, aad);
check('Agent加密→手机解密往返', phonePlain && new TextDecoder().decode(phonePlain) === 'C 盘剩余 128GB');

// 篡改密文 → 解密失败
const tamper = { ...box, ciphertext: (() => { const b = box.ciphertext.replace(/-/g,'+').replace(/_/g,'/'); return box.ciphertext; })() };
const bad = await decrypt(agentKey, { ciphertext: flip(box.ciphertext), iv: box.iv, tag: box.tag }, aad);
check('篡改密文认证失败', bad === null);

// AAD 不匹配 → 失败
const noAad = await decrypt(agentKey, box, 'wrong-aad');
check('AAD 不匹配失败', noAad === null);

// 用错误的公钥（另一台 Agent）解密 → 失败（密钥绑定了对端公钥）
const otherAgent = await generateKeyPair();
const wrongKey = await deriveSessionKey(otherAgent.privateKey, phone.publicKey, salt);
const wrongPlain = await decrypt(wrongKey, box, aad);
check('对端公钥不匹配时解密失败', wrongPlain === null);

// 公钥是 JWK JSON，可存储/传输
check('公钥可序列化', (()=>{ try { JSON.parse(phone.publicKey); return true; } catch { return false; } })());

function flip(b64u) {
  const b = b64u.replace(/-/g,'+').replace(/_/g,'/');
  const bin = atob(b);
  const u = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
  if (u.length) u[0] ^= 1;
  let s = String.fromCharCode(...u);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

console.log('\n===== 汇总 =====');
const passed = results.filter(r=>r.ok).length;
console.log(`${passed}/${results.length} 通过`);
if (passed < results.length) { results.filter(r=>!r.ok).forEach(r=>console.log('  -',r.name,r.detail)); process.exit(1); }
