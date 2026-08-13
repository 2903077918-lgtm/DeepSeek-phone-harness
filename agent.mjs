#!/usr/bin/env node
// deepseekharness-relay Agent 入口 —— 装配各模块
// 用法: node agent.mjs [--mode lan|both]
//   lan  (默认): 局域网直连 + headless 执行
//   both:        headless 保底 + DSH Web API 优先（流式）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './src/config.js';
import { createHistory } from './src/history.js';
import { createQueue } from './src/queue.js';
import { createExecutor } from './src/executor.js';
import { createLanTransport } from './src/transport-lan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = __dirname;

// 解析启动参数 --mode
const modeArg = process.argv.find((a) => a.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'lan';
if (mode !== 'lan' && mode !== 'both') {
  console.error('未知 mode: ' + mode + '（支持 lan / both）');
  process.exit(1);
}

const config = loadConfig(ROOT_DIR);
const history = createHistory(ROOT_DIR);
const queue = createQueue();
const executor = createExecutor({ mode });
const lan = createLanTransport({ config, rootDir: ROOT_DIR, executor, history, queue });

lan.start();
console.log('[deepseekharness-relay] 执行模式: ' + (mode === 'both' ? 'both（Web API 优先 + headless 保底）' : 'lan（headless）'));
