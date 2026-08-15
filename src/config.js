// src/config.js —— 配置与 API key 解析
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PORT = 8788; // 8787 已被本机 Codex Relay 占用
export const HOST = '0.0.0.0'; // 局域网可访问；公网使用需前置安全网关
export const DSH_CMD = 'dsh';
export const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 单任务最长 10 分钟
export const AGENT_VERSION = '0.4.0';

export function resolveApiKey(rootDir) {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  try {
    const regOut = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'DEEPSEEK_API_KEY'], { encoding: 'utf8', windowsHide: true });
    const m = /DEEPSEEK_API_KEY\s+REG_SZ\s+(.+)/.exec(regOut);
    if (m) return m[1].trim();
  } catch { /* registry unavailable */ }
  try {
    const envFile = path.join(rootDir, '.env');
    if (existsSync(envFile)) {
      const line = readFileSync(envFile, 'utf8').split('\n').find(l => l.startsWith('DEEPSEEK_API_KEY='));
      if (line) return line.slice('DEEPSEEK_API_KEY='.length).trim();
    }
  } catch { /* no .env */ }
  return undefined;
}

export function loadConfig(rootDir) {
  const CONFIG_PATH = path.join(rootDir, 'config.json');
  if (existsSync(CONFIG_PATH)) {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  }
  const cfg = { token: crypto.randomBytes(24).toString('hex'), createdAt: new Date().toISOString() };
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return cfg;
}
