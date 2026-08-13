// src/history.js —— 历史记录（JSON 文件，最多保留 200 条）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export function createHistory(rootDir) {
  const HISTORY_PATH = path.join(rootDir, 'history.json');
  function load() {
    if (!existsSync(HISTORY_PATH)) return [];
    try { return JSON.parse(readFileSync(HISTORY_PATH, 'utf8')); } catch { return []; }
  }
  function append(entry) {
    const h = load();
    h.unshift(entry);
    writeFileSync(HISTORY_PATH, JSON.stringify(h.slice(0, 200), null, 2));
  }
  function list() {
    return load();
  }
  return { load, append, list };
}
