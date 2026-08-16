#!/usr/bin/env node
// deepseekharness-relay Agent 入口 —— 装配各模块
// 用法: node agent.mjs [--mode lan|both|cloud]
//   lan  (默认): 局域网直连 + headless 执行
//   both:       headless 保底 + DSH Web API 优先（流式）+ 云端通道（可选）
//   cloud:      云端通道（WSS 出站连 cloud-relay）接收任务；不监听 LAN
// LAN 与云端共用同一 executor；cloud 配置在 config.json 的 cloud 节（未配对则跳过云端并提示）
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig, AGENT_VERSION } from './src/config.js';
import { createHistory } from './src/history.js';
import { createQueue } from './src/queue.js';
import { createExecutor } from './src/executor.js';
import { createLanTransport } from './src/transport-lan.js';
import { createCloudPoller } from './src/cloud-poller.mjs';
import { ensureE2EEKey, registerDevice, restBaseFromWs } from './src/cloud-register.mjs';
import { ensureVapidKeys, createPushStore } from './src/web-push.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = __dirname;

// 解析启动参数 --mode
const modeArg = process.argv.find((a) => a.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'lan';
if (!['lan', 'both', 'cloud'].includes(mode)) {
  console.error('未知 mode: ' + mode + '（支持 lan / both / cloud）');
  process.exit(1);
}

const config = loadConfig(ROOT_DIR);
const history = createHistory(ROOT_DIR);
const queue = createQueue();
// 云端模式不监听 LAN；executor 仍可 headless 执行（远端任务进来本地跑）
const executor = createExecutor({ mode: mode === 'cloud' ? 'lan' : mode });

// ---- Web Push 推送（审批/提问/任务完成 → 手机通知）----
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const pushKeys = ensureVapidKeys(config, CONFIG_PATH);
const pushStore = createPushStore(path.join(ROOT_DIR, 'push-subscriptions.json'));
const push = {
  publicKeyB64: (() => { const x = pushKeys.vapidPublic; return Buffer.from([4, ...Buffer.from(x.x, 'base64url'), ...Buffer.from(x.y, 'base64url')]).toString('base64url'); })(),
  vapidJwk: pushKeys.vapidPublic, // notifyAll 只用公钥做 Authorization；私钥在 sendPush 内部用
  store: pushStore,
  notify: (payload) => pushStore.notifyAll(pushKeys.vapidPublic, { ...payload, title: 'DeepSeek Harness', at: Date.now() }),
};
executor.setPushNotifier({ notify: push.notify });

// ---- LAN 通道（lan / both；cloud 不监听 LAN）----
if (mode !== 'cloud') {
  const lan = createLanTransport({ config, rootDir: ROOT_DIR, executor, history, queue, push });
  lan.start();
  console.log('[deepseekharness-relay] LAN 已启动（8788）');
}

// ---- 云端通道（both / cloud）----
if (mode === 'both' || mode === 'cloud') {
  const cloudCfg = config.cloud;
  if (cloudCfg && cloudCfg.url && cloudCfg.deviceToken) {
    try {
      // 1. 确保 E2EE 密钥就位（P-256 私钥本机持久化，公钥注册上报）
      const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
      const e2ee = await ensureE2EEKey(config, CONFIG_PATH);
      // 2. 尝试 REST 注册设备 + 上报公钥，拿配对码提示用户
      const restBase = restBaseFromWs(cloudCfg.url);
      const agentId = cloudCfg.deviceId || 'agent-' + crypto.randomBytes(4).toString('hex');
      if (restBase && e2ee.publicKey) {
        try {
          const pairCode = await registerDevice({
            host: restBase, agentId,
            publicKey: e2ee.publicKey,
            name: cloudCfg.deviceName || agentId,
            token: config.token,   // LAN Bearer token → 云端存哈希，手机云端直连 /api/* 用
          });
          if (pairCode) console.log('[deepseekharness-relay] 设备配对码: ' + pairCode + '（15 分钟内到手机 cloud.html 输入绑定）');
        } catch (e) {
          console.warn('[deepseekharness-relay] 设备上报失败（可稍后手动注册）: ' + e.message);
        }
      }

      // 轮询模式（Vercel 友好，无长连接）：定时拉任务→E2EE 解密→executor→回传
      const poller = createCloudPoller({
        config,
        executor,
        pollIntervalMs: cloudCfg.pollIntervalMs || 3000,
        lanBase: 'http://127.0.0.1:8788',   // 云端 /api/* 中继回环到本地 LAN 传输层
        lanToken: config.token || '',
      });
      poller.start();
      console.log('[deepseekharness-relay] 云端轮询已启动: ' + restBase + '（每 ' + (cloudCfg.pollIntervalMs || 3000) + 'ms）');
    } catch (e) {
      console.error('[deepseekharness-relay] 云端启动失败: ' + String(e));
    }
  } else {
    console.warn('[deepseekharness-relay] 未配置 cloud（config.json.cloud.url/deviceToken），跳过云端');
  }
}

console.log('[deepseekharness-relay] 执行模式: ' + mode);
