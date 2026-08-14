// src/guard.js —— 高风险指令检测 + 确认分级（纯函数，可独立单测）
// 对应 docs/architecture/cloud-architecture.md 第 3.4 节。
// 基于正则 + 启发式对一条 prompt（或命令）判定风险级别 low/medium/high，
// 并给出人类可读的风险摘要，供云端 confirm.request 与本地审计使用。
// 注意：这是启发式预判，Agent 侧对 DSH 工具调用仍需在真实执行前做等价检测（阶段3 后续接线）。

export const RISK_LOW = 'low';
export const RISK_MEDIUM = 'medium';
export const RISK_HIGH = 'high';

// high 级：可能造成不可逆破坏 / 提权 / 高危副作用
const HIGH_PATTERNS = [
  { re: /\b(Remove-Item|rm|rmdir|rm -rf|del \/[fs]|unlink|shutil\.rmtree|os\.remove)\b/i, label: '删除文件/目录' },
  { re: /\b(format|mkfs|diskpart|dd)\b/i, label: '格式化/磁盘操作' },
  { re: /\b(fdisk|parted|wipe|shred|secure.?erase)\b/i, label: '磁盘擦除/分区' },
  { re: /\b(reg add|reg delete|regedit)\b/i, label: '注册表修改' },
  { re: /\b(Stop-Service|net stop|sc stop|shutdown|reboot|systemctl stop)\b/i, label: '停止服务/关机重启' },
  { re: /\b(RunAs|sudo|gsudo|设置?UID|elevat)\b/i, label: '提权' },
  { re: /\b(rm -rf|Remove-Item -Recurse -Force|rmtree|--force|no.?confirm)\b/i, label: '强制/递归删除' },
  { re: /\b(Set-ExecutionPolicy|iptables|netsh|firewall)\b/i, label: '安全设置修改' },
  { re: /\b(清空|重置|删除.*(数据库|db|table|集合)|truncate|drop table)\b/i, label: '数据库破坏性操作' },
];

// medium 级：写文件到用户目录 / 网络请求 / 进程管理 / 批量操作
const MEDIUM_PATTERNS = [
  { re: /\b(download|curl|wget|Invoke-WebRequest|New-Item|Set-Content|Add-Content)\b/i, label: '写文件/网络下载' },
  { re: /\b(Start-Process|New-Process|npx|npm i|pip install|conda install)\b/i, label: '启动进程/安装依赖' },
  { re: /\b(move|copy|cp|mv|Move-Item|Copy-Item)\b/i, label: '移动/复制文件' },
  { re: /\b(kill|Stop-Process|taskkill)\b/i, label: '终止进程' },
  { re: /\b(scp|ssh|telnet|nc -|\/dev\/tcp)\b/i, label: '网络连接/远程' },
];

/**
 * 对一条 prompt（或命令）进行风险分级。
 * @param {string} text 用户下发内容
 * @returns {'low'|'medium'|'high'}
 */
export function detectRiskLevel(text) {
  const t = String(text || '');
  if (!t) return RISK_LOW;
  if (HIGH_PATTERNS.some((p) => p.re.test(t))) return RISK_HIGH;
  if (MEDIUM_PATTERNS.some((p) => p.re.test(t))) return RISK_MEDIUM;
  return RISK_LOW;
}

// 收集命中的风险标签（供摘要 / 审计 / 决策展示）
export function collectRiskTags(text) {
  const t = String(text || '');
  const tags = [];
  for (const p of HIGH_PATTERNS) if (p.re.test(t) && !tags.includes(p.label)) tags.push(p.label);
  for (const p of MEDIUM_PATTERNS) if (p.re.test(t) && !tags.includes(p.label)) tags.push(p.label);
  return tags;
}

/**
 * 生成人类可读的风险摘要。
 * @returns {string} 例如 "高风险：删除文件/目录；强制/递归删除"
 */
export function summarizeRisk(text) {
  const t = String(text || '');
  const level = detectRiskLevel(t);
  const tags = collectRiskTags(t);
  const head = level === 'high' ? '高风险' : level === 'medium' ? '中风险' : '低风险';
  return tags.length ? head + '：' + tags.join('；') : head;
}

/**
 * 是否要求确认（按确认策略）。
 * @param {'always'|'high'|'whitelist'} policy 每设备可配置（架构文档确认策略）
 * @param {'low'|'medium'|'high'} level
 * @param {string[]} [whitelistTags] 白名单免确认标签（policy=whitelist 时匹配部分）
 */
export function requiresConfirm(policy, level, whitelistTags = []) {
  if (policy === 'always') return true;
  if (policy === 'high') return level === 'high';
  if (policy === 'whitelist') return level === 'high' && !whitelistTags.some((t) => (t === level));
  return false; // 未知策略默认不确认（fail-open for policy code, fail-safe covered in caller）
}
