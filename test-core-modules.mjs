// test-core-modules.mjs —— 阶段3 新模块单测：protocol / e2ee / guard / audit
// 独立运行，不依赖 DSH / agent / 网络。用法：node test-core-modules.mjs
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createEnvelope, parseEnvelope, validateEnvelope, MSG_TYPES, createSeq,
} from './src/protocol.js';
import {
  generateKeyPair, deriveSessionKey, encrypt, decrypt, generateKeySalt,
} from './src/e2ee.js';
import {
  detectRiskLevel, summarizeRisk, collectRiskTags, requiresConfirm, RISK_HIGH, RISK_MEDIUM, RISK_LOW,
} from './src/guard.js';
import { createAuditLog } from './src/audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log((cond ? '✅' : '❌'), name, detail ? '| ' + detail : '');
}

// ---- protocol ----
const env = createEnvelope(MSG_TYPES.TASK_SUBMIT, { deviceId: 'dev_1', seq: 42 }, { taskId: 'tsk_1' });
check('envelope 结构字段', env.v === 1 && env.type === MSG_TYPES.TASK_SUBMIT && env.deviceId === 'dev_1');
const parsed = parseEnvelope(JSON.stringify(env));
check('parse/validate 往返', validateEnvelope(parsed) && parsed.msgId === env.msgId);
check('坏帧 → null', parseEnvelope('not json') === null && parseEnvelope('') === null);
const bad = parseEnvelope(JSON.stringify({ v: 9, type: 'x' })); // v 版本/缺 msgId → 非法
check('版本不匹配拒绝', validateEnvelope(bad) === false);
const seq = createSeq();
check('createSeq 单调', seq.next() === 1 && seq.next() === 2 && seq.current() === 2);

// ---- e2ee ----
const device = await generateKeyPair();
const phone = await generateKeyPair();
const salt = generateKeySalt();
check('密钥对非空', !!device.publicKey && !!device.privateKey && device.publicKey !== device.privateKey);
const keyD = await deriveSessionKey(device.privateKey, phone.publicKey, salt);
const keyP = await deriveSessionKey(phone.privateKey, device.publicKey, salt);
check('双向共享密钥一致', keyD.equals(keyP) && keyD.length === 32);
const aad = JSON.stringify({ taskId: 'tsk_t', deviceId: 'dev_1' });
const box = encrypt(keyD, '删除 C:\\temp 目录', aad);
const plain = decrypt(keyP, box, aad);
check('加密→解密往返', plain != null && plain.toString('utf8') === '删除 C:\\temp 目录');
check('错误 AAD 认证失败', decrypt(keyP, box, '{bad}') === null);
// 篡改密文 → 认证失败（构造一个字节翻转的密文）
const ctBuf = Buffer.from(box.ciphertext, 'base64url');
ctBuf[0] ^= 1;
const badCrypt = decrypt(keyP, { ...box, ciphertext: ctBuf.toString('base64url') }, aad);
check('篡改密文认证失败', badCrypt === null);

// ---- guard ----
check('high: rm -rf', detectRiskLevel('删除 C:/temp 全部文件，rm -rf') === RISK_HIGH);
check('high: 格式化', detectRiskLevel('format E: 盘') === RISK_HIGH);
check('medium: 下载', detectRiskLevel('curl 下载 update.exe 并运行') === RISK_MEDIUM);
check('low: 只读查询', detectRiskLevel('检查 C 盘剩余空间') === RISK_LOW);
check('summarizeRisk low', summarizeRisk('看磁盘') === '低风险');
check('summarizeRisk high 命中标签', summarizeRisk('rm -rf 清空') .includes('高风险'));
check('requiresConfirm high(默认)', requiresConfirm('high', RISK_HIGH) === true);
check('requiresConfirm high(medium)', requiresConfirm('high', RISK_MEDIUM) === false);
check('requiresConfirm always', requiresConfirm('always', RISK_LOW) === true);
const tags = collectRiskTags('Remove-Item -Recurse -Force 删掉；然后 reformat 磁盘');
check('collectRiskTags 命中', tags.some((t) => !!(t)));

// ---- audit ----
const tmpFile = path.join(os.tmpdir(), 'ph-audit-' + Date.now() + '.json');
const log = createAuditLog(tmpFile);
const r1 = log.append('task.result', { taskId: 'tsk_1' });
const r2 = log.append('confirm.decision', { decision: 'allow' });
const lines = readFileSync(tmpFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
check('audit 追加两条', lines.length === 2);
check('audit hash chain', r1.prevHash === null && r2.prevHash === r1.hash);
if (existsSync(tmpFile)) unlinkSync(tmpFile);

console.log('\n===== 汇总 =====');
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} 通过`);
if (passed < results.length) {
  results.filter((r) => !r.ok).forEach((r) => console.log('  -', r.name, r.detail));
  process.exit(1);
}
