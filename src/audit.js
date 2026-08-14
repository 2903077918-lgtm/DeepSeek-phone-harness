// src/audit.js —— 本地追加式审计日志（JSONL + 可选 hash chain 防篡改）
// 对应 docs/architecture/cloud-architecture.md 第 3.5 节：Agent 本地 audit.json 追加式日志，
// 防云端不可信时本地留痕；可选 hash chain（每行含上一行哈希）防篡改。
// 纯本地文件，可独立单测。写入失败静默降级（不阻塞主流程）。

import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * 创建本地审计日志。
 * @param {string} filePath 目标文件（默认 <rootDir>/audit.json）
 * @param {object} [opts]
 * @param {boolean} [opts.hashChain=true] 每行携带 prevHash 形成链条
 * @param {string}  [opts.encoding=utf8]
 */
export function createAuditLog(filePath, opts = {}) {
  const { hashChain = true, encoding = 'utf8' } = opts;
  const file = filePath;
  let prevHash = null;

  try {
    mkdirSync(path.dirname(file), { recursive: true });
  } catch { /* 目录创建失败由 append 时兜底 */ }

  function hashLine(previous) {
    const seed = previous || 'null';
    return createHash('sha256').update(seed).digest('hex');
  }

  /**
   * 追加一条审计记录（同步写，保证顺序）。
   * @param {string} action  动作（如 task.result、confirm.decision、bind.revoked）
   * @param {object} [detail]
   * @param {object} [meta]  {time?, hashChain}
   */
  function append(action, detail = {}, meta = {}) {
    const rec = {
      at: meta.time || new Date().toISOString(),
      action,
      detail,
    };
    if (hashChain !== false) {
      rec.prevHash = prevHash || null;
      rec.hash = createHash('sha256')
        .update(JSON.stringify({ at: rec.at, action: rec.action, detail: rec.detail, prev: rec.prevHash }))
        .digest('hex');
      prevHash = rec.hash;
    }
    const line = JSON.stringify(rec) + '\n';
    try {
      appendFileSync(file, line, encoding);
    } catch { /* 审计失败不阻塞主流程 */ }
    return rec;
  }

  return { append, get file() { return file; } };
}

export { createHash };
