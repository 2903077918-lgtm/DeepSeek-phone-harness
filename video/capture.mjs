// 阶段4 素材采集：真实 relay.html + 虚构演示数据 → 全页2x + 元素切片 + layout.json
// 运行：node capture.mjs
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Joey/AppData/Local/Temp/ph-ui-test/node_modules/playwright-core');

const OUT = new URL('./remotion/public/textures/live/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(OUT, { recursive: true });

const TOKEN = process.env.PH_TOKEN || 'eaa8e4ef031fa3acb5c2b60e097408a7edd07d671f6457a04c19294514708b59';
const BASE = 'http://127.0.0.1:8788';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

// 虚构演示数据（数据脱敏：所有内容均为虚构）
const FICTIONS = {
  userText: '帮我检查 config.json 的配置，然后跑一遍测试',
  asstText: '配置检查完成，没有发现问题。测试也全部通过了，可以放心继续。',
  toolRead: { name: 'read', path: 'C:/Users/demo/My-Project/config.json' },
  toolShell: { name: 'pwsh', path: 'npm test' },
  toolWrite: { name: 'write', path: 'C:/Users/demo/My-Project/src/utils.ts' },
  question: { header: '确认执行', text: '要执行 npm run deploy 把当前分支发布到测试环境吗？' },
};

async function fillFictionalChat() {
  await page.evaluate((F) => {
    const tl = document.getElementById('timeline');
    if (!tl) return;
    tl.textContent = '';
    const add = (html) => { const d = document.createElement('div'); d.innerHTML = html; tl.appendChild(d); };
    // 用户消息
    add('<div class="msg user"><div class="bubble">' + F.userText + '</div></div>');
    // 工具卡 read（完成）
    add('<div class="tool-card-wrap"><div class="tool-card done"><div class="tc-head"><span class="tc-ic"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span><span class="tc-name">read</span><span class="tc-status"><span class="tc-dot"></span>完成</span></div><div class="tc-args">' + F.toolRead.path + '</div></div></div>');
    // 工具卡 pwsh（运行中）
    add('<div class="tool-card-wrap"><div class="tool-card run"><div class="tc-head"><span class="tc-ic"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg></span><span class="tc-name">pwsh</span><span class="tc-status run"><span class="spin"></span>执行中</span></div><div class="tc-args">' + F.toolShell.path + '</div></div></div>');
    // 助手消息
    add('<div class="msg asst"><div class="avatar">DSH</div><div class="bubble"><div class="asst-label">deepseekharness</div><div class="asst-body"><p>' + F.asstText + '</p></div></div></div>');
    // 提问卡
    add('<div class="appr-card"><div class="t">需要你回答</div><div class="q-eyebrow">' + F.question.header + '</div><div class="q-title">' + F.question.text + '</div><div class="q-opts"><button type="button" class="q-opt on"><span class="q-opt-num">1</span><span class="q-opt-body"><span class="q-opt-label">执行</span></span></button><button type="button" class="q-opt"><span class="q-opt-num">2</span><span class="q-opt-body"><span class="q-opt-label">跳过</span></span></button></div></div>');
    tl.style.padding = '16px 14px';
  }, FICTIONS);
  await page.waitForTimeout(600);
}

try {
  // 连接并进入对话页（素材为注入的虚构 DOM，无需真实工作区/会话）
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#serverUrl', { state: 'visible', timeout: 10000 });
  await page.fill('#serverUrl', BASE);
  await page.fill('#tokenInput', TOKEN);
  await page.click('#connectBtn');
  await page.waitForSelector('#paneChat:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // 注入虚构对话
  await fillFictionalChat();

  // 1) 对话页全页 2x（786x1704）
  await page.screenshot({ path: OUT + 'chat-full.png' });
  console.log('chat-full.png saved');

  // 2) layout.json + 元素切片（按 bbox 截图）
  const layout = await page.evaluate(() => {
    const out = { pageW: document.documentElement.scrollWidth, pageH: document.documentElement.scrollHeight };
    const grab = (sel, name) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const s = el.scrollHeight > el.clientHeight ? el.scrollHeight : r.height;
      out[name] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(s) };
    };
    grab('.tool-card.done', 'toolRead');
    grab('.tool-card.run', 'toolShell');
    grab('.appr-card', 'questionCard');
    grab('.msg.asst .bubble', 'asstBubble');
    grab('.msg.user .bubble', 'userBubble');
    return out;
  });
  writeFileSync(OUT + 'layout.json', JSON.stringify(layout, null, 2));
  console.log('layout.json:', JSON.stringify(layout));

  // 元素切片（clip 截图，透明背景不可用 → 保留页面背景）
  const clips = [
    ['.tool-card.done', 'tool-read.png'],
    ['.tool-card.run', 'tool-shell.png'],
    ['.appr-card', 'question-card.png'],
    ['.msg.asst .bubble', 'asst-bubble.png'],
    ['.msg.user .bubble', 'user-bubble.png'],
  ];
  for (const [sel, file] of clips) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      await el.screenshot({ path: OUT + file });
      console.log(file, 'saved');
    }
  }

  // 3) 模型胶囊行（如可见才截；无会话时隐藏，跳过即可）
  try {
    const modelRow = page.locator('.model-pill:visible');
    if (await modelRow.count()) { await modelRow.screenshot({ path: OUT + 'model-pill.png' }); console.log('model-pill.png saved'); }
  } catch { /* 不可见则跳过 */ }

  // 4) 连接页（鲸鱼品牌页，备用素材）
  try {
    await page.click('#connPill');
    await page.waitForTimeout(800);
    await page.screenshot({ path: OUT + 'connect-full.png' });
    console.log('connect-full.png saved');
  } catch { /* 跳过 */ }

  // 5) 终端页（复用 relay.html .term-pre 样式，注入虚构终端输出）
  try {
    await page.evaluate(() => {
      const tl = document.getElementById('timeline');
      if (!tl) return;
      tl.textContent = '';
      const pre = document.createElement('pre');
      pre.className = 'term-pre';
      pre.style.fontSize = '13px';
      const lines = [
        'C:\\Users\\demo> cd My-Project',
        'C:\\Users\\demo\\My-Project> git status',
        '  On branch main, 2 files changed',
        'C:\\Users\\demo\\My-Project> npm test',
      ];
      lines.forEach((l) => { const s = document.createElement('span'); s.textContent = l + '\n'; pre.appendChild(s); });
      const ok = document.createElement('span');
      ok.className = 't-ok'; ok.textContent = '  ✓ 12 tests passed (2.4s)\n';
      pre.appendChild(ok);
      const cur = document.createElement('span'); cur.textContent = 'C:\\Users\\demo\\My-Project> _'; pre.appendChild(cur);
      const wrap = document.createElement('div');
      wrap.style.background = '#0B0C10'; wrap.style.border = '1px solid var(--border)'; wrap.style.borderRadius = '12px'; wrap.style.padding = '16px';
      wrap.appendChild(pre);
      tl.appendChild(wrap);
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: OUT + 'terminal-full.png' });
    console.log('terminal-full.png saved');
  } catch (e) { console.log('terminal skipped:', String(e).slice(0, 80)); }

  // 6) 文件页（复用 relay.html .file-item 样式，注入虚构文件树）
  try {
    await page.evaluate(() => {
      const tl = document.getElementById('timeline');
      if (!tl) return;
      tl.textContent = '';
      const head = document.createElement('div');
      head.style.cssText = 'font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px';
      head.textContent = 'My-Project /';
      tl.appendChild(head);
      const FILES = [
        ['dir', 'src'], ['dir', 'tests'], ['dir', 'docs'],
        ['file', 'config.json'], ['file', 'package.json'], ['file', 'README.md'],
        ['file', 'agent.mjs'], ['file', 'relay.html'],
      ];
      FILES.forEach(([type, name]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'file-item' + (type === 'dir' ? ' dir' : '');
        b.style.cssText = 'width:100%;display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--bg-el);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;color:var(--text)';
        b.innerHTML = '<span class="ic">' + (type === 'dir'
          ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
          : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>') + '</span>' +
          '<span class="t" style="flex:1;text-align:left;font-size:14px;font-weight:600">' + name + '</span>' +
          (type === 'file' ? '<span class="s" style="font-size:11px;color:var(--text-2)">' + (name.split('.').pop() || '') + '</span>' : '');
        tl.appendChild(b);
      });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: OUT + 'files-full.png' });
    console.log('files-full.png saved');
  } catch (e) { console.log('files skipped:', String(e).slice(0, 80)); }
} finally {
  await browser.close();
}
console.log('CAPTURE DONE');
