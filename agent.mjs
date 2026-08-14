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
import { createCloudTransport } from './src/transport/cloud.mjs';
import { createCloudService } from './src/cloud-service.mjs';

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

// ---- LAN 通道（lan / both；cloud 不监听 LAN）----
if (mode !== 'cloud') {
  const lan = createLanTransport({ config, rootDir: ROOT_DIR, executor, history, queue });
  lan.start();
  console.log('[deepseekharness-relay] LAN 已启动（8788）');
}

// ---- 云端通道（both / cloud）----
if (mode === 'both' || mode === 'cloud') {
  const cloudCfg = config.cloud;
  if (cloudCfg && cloudCfg.url && cloudCfg.deviceToken) {
    try {
      const transport = createCloudTransport({
        url: cloudCfg.url,
        deviceId: cloudCfg.deviceId || 'agent-' + crypto.randomBytes(4).toString('hex'),
        deviceToken: cloudCfg.deviceToken,
        resumeToken: cloudCfg.resumeToken || null,
        version: AGENT_VERSION,
        capabilities: ['headless', 'web', 'confirm', 'e2ee-v1'],
        pendingTasks: [],
      });
      createCloudService({ transport, executor, config, confirmPolicy: cloudCfg.confirmPolicy || 'high' });
      transport.connect();
      console.log('[deepseekharness-relay] 云端已连接: ' + cloudCfg.url);
    } catch (e) {
      console.error('[deepseekharness-relay] 云端启动失败: ' + String(e));
    }
  } else {
    console.warn('[deepseekharness-relay] 未配置 cloud（config.json.cloud.url/deviceToken），跳过云端');
  }
}

console.log('[deepseekharness-relay] 执行模式: ' + mode);
