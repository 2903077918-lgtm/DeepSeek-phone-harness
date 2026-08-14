// test-poll-e2e.mjs —— 端到端轮询闭环验证（本地，真实 Supabase）
// 流程：本地 http server 包装 esbuild 打包的 cloud-relay handler(注入 Supabase env) →
//       模拟"手机"注册设备+生成P-256密钥+加密任务 POST /v1/tasks →
//       Agent createCloudPoller 连本地 server 轮询 → 解密→executor→加密结果 POST result →
//       断言：poller 解密执行且手机能解密结果。
// 用法：先跑过一次 `npx esbuild src/index.ts --bundle ... cr-bundle.mjs`，再 node test-poll-e2e.mjs
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { generateKeyPair, deriveSessionKey, encrypt, decrypt, generateKeySalt } from './src/e2ee-web.js';
import { createCloudPoller } from './src/cloud-poller.mjs';

const results = [];
function check(name, cond, detail = '') { results.push({ name, ok: !!cond, detail }); console.log((cond?'✅':'❌'), name, detail||''); }

// 读 Supabase creds
const dv = readFileSync('cloud-relay/.dev.vars', 'utf8');
const url = (dv.match(/SUPABASE_URL=(.+)/)||[])[1]?.trim();
const key = (dv.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)||[])[1]?.trim();
if (!url || !key) { console.error('缺 cloud-relay/.dev.vars 的 SUPABASE_URL/KEY'); process.exit(1); }

// bundle 打包的 cloud-relay handler
const mod = await import(pathToFileURL(process.env.TEMP + '/cr-bundle.mjs').href);
const cloudRelay = mod.default; // { fetch(request, env) }

// 本地 server 包装 handler
const env = { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key };
const server = http.createServer(async (req, res) => {
  const body = [];
  req.on('data', c => body.push(c));
  req.on('end', async () => {
    const buf = Buffer.concat(body);
    const hasBody = buf.length > 0;
    const hr = new Request('http://127.0.0.1:8792' + (req.url || '/'), {
      method: req.method, headers: req.headers,
      body: hasBody ? buf : undefined,
    });
    try {
      const cr = await cloudRelay.fetch(hr, env);
      res.writeHead(cr.status, { 'content-type': 'application/json' });
      res.end(await cr.text());
    } catch (e) { res.writeHead(500, {'content-type':'application/json'}); res.end(JSON.stringify({error:String(e)})); }
  });
});
await new Promise(r => server.listen(8792, r));
const base = 'http://127.0.0.1:8792';
async function api(path, body) {
  const r = await fetch(base+path, { method: body?'POST':'GET', headers:{'content-type':'application/json'}, body: body?JSON.stringify(body):undefined });
  return { status:r.status, data: await r.json().catch(()=>({})) };
}

// 1. 模拟手机：注册账号 + 注册一个 Agent 设备并上报公钥 + 用配对码绑定
const user = await api('/v1/auth/register', { email: 'e2e'+Date.now()+'@poll.test', password: 'Pass#2026x' });
const userId = user.data.userId;
check('注册测试账号', !!userId, userId||JSON.stringify(user.data));
const agentKey = await generateKeyPair();          // Agent 密钥(实际在 Agent 侧,这里预生成供对照)
const agentId = 'e2e-agent-' + Date.now().toString(36);
const reg = await api('/v1/devices/register', { agentId, name: 'e2e', publicKey: agentKey.publicKey });
check('设备注册返回配对码', !!reg.data.pairCode, reg.data.pairCode||'(reg fail)');
const pair = await api('/v1/devices/' + agentId + '/pair', { pairCode: reg.data.pairCode, userId });
check('设备配对绑定', pair.data && pair.data.ok === true, JSON.stringify(pair.data));

// 2. 模拟手机：生成自己密钥 + 加密任务
const phone = await generateKeyPair();
const salt = generateKeySalt();
const phoneKey = await deriveSessionKey(phone.privateKey, agentKey.publicKey, salt);
const text = 'e2e轮询测试' + Date.now();
const box = await encrypt(phoneKey, text, 'ph-task');
const create = await api('/v1/tasks', { deviceId: agentId, userId, promptCipher: box, senderKey: phone.publicKey, salt, requireConfirm: false });
check('创建加密任务', create.status===201 && !!create.data.taskId, 'taskId='+(create.data.taskId||'fail')+' HTTP'+create.status);

// 3. Agent poller 连本地 server 轮询（用 e2e-agent 私钥派生解密）
let executed = null;
const fakeExecutor = { async run(prompt){ executed = prompt; return { ok:true, exitCode:0, stdout:'结果:'+prompt, stderr:'', elapsedMs:5 }; } };
const poller = createCloudPoller({ config: { cloud: { url: 'http://127.0.0.1:8792/x', deviceId: agentId, e2ee: { privateKey: agentKey.privateKey }, pollIntervalMs: 500 } }, executor: fakeExecutor });
await poller.pollOnce();
await new Promise(r => setTimeout(r, 400));
check('poller 解密并执行了手机任务', executed === text, 'got='+executed);

// 4. 结果是否回传到云端且手机可解密
const tasks = (await api('/v1/tasks?deviceId=' + agentId)).data.items || [];
const done = tasks.find(t => t.id === create.data.taskId);
check('任务状态为终态 succeeded', done && done.status === 'succeeded', done && done.status);
let phoneDec = null;
if (done && done.result_cipher) {
  const rk = await deriveSessionKey(phone.privateKey, agentKey.publicKey, done.salt); // 结果用任务 salt
  const dec = await decrypt(rk, done.result_cipher, done.id);
  phoneDec = dec ? new TextDecoder().decode(dec) : null;
}
check('手机能解密结果密文', !!phoneDec && phoneDec.includes('结果:e2e轮询'), phoneDec||'');

server.close();
console.log('\n===== 汇总 =====');
const passed = results.filter(r=>r.ok).length;
console.log(`${passed}/${results.length} 通过`);
process.exit(passed===results.length?0:1);
