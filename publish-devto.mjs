// dev.to 批量发布脚本：用法 DEVTO_TOKEN=xxx node publish-devto.mjs [文章文件...]
// 不传参数则发布全部英文文章
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const TOKEN = process.env.DEVTO_TOKEN;
if (!TOKEN) { console.error('缺少 DEVTO_TOKEN 环境变量'); process.exit(1); }

const API = 'https://dev.to/api/articles';

// 文章清单：文件名 -> 标题（默认全部英文篇）
const DEFAULT_FILES = [
  'promo-article.en.md',
  'tech-article.en.md',
  'tutorial.en.md',
  'viral-1.en.md',
  'viral-2.en.md',
  'viral-3.en.md',
  'viral-4.en.md',
  'viral-5.en.md',
  'viral-6.en.md',
  'viral-7.en.md',
  'viral-8.en.md',
  'en-tech-deep.md',
  'en-open-source.md',
  'en-roadmap.md',
];
const TITLES = {
  'promo-article.en.md': 'DeepSeek Phone Harness: Remote-Control Your Desktop Agent from Your Phone',
  'tech-article.en.md': 'Remote-Controlling a Desktop Agent with Zero Dependencies: Under the Hood',
  'tutorial.en.md': 'Run DeepSeek Phone Harness in Five Minutes: Control Your Computer from Your Phone over 4G',
  'viral-1.en.md': 'I turned my phone into a remote for DeepSeek Harness — and it changed how I use agents',
  'viral-2.en.md': 'DeepSeek Harness is useless when you leave the desk — so I open-sourced a fix',
  'viral-3.en.md': '3 traps I fell into while letting a phone control a desktop agent',
  'viral-4.en.md': 'Watching my agent work from the phone and the desktop at the same time',
  'viral-5.en.md': "The agent's next stop is your pocket: why mobile may be the agent's best form",
  'viral-6.en.md': 'From "a thought in bed" to open source: one week of development diary',
  'viral-7.en.md': 'The 5 agent tasks I most often run from my phone: a real list',
  'viral-8.en.md': '"Remote-controlling your agent from a phone" — the 10 questions everyone asks',
  'en-tech-deep.md': 'Streaming a desktop agent to your phone with zero npm dependencies',
  'en-open-source.md': 'Why I open-sourced the tool I built "just for myself"',
  'en-roadmap.md': 'Where DeepSeek Phone Harness goes next — and how you can shape it',
};
const TAGS = {
  'promo-article.en.md': ['deepseek', 'opensource', 'agent', 'productivity'],
  'tech-article.en.md': ['node', 'deepseek', 'architecture', 'opensource'],
  'tutorial.en.md': ['deepseek', 'tutorial', 'tailscale', 'productivity'],
  'viral-1.en.md': ['deepseek', 'opensource', 'story', 'agent'],
  'viral-2.en.md': ['deepseek', 'opensource', 'agent', 'productivity'],
  'viral-3.en.md': ['node', 'deepseek', 'debugging', 'opensource'],
  'viral-4.en.md': ['deepseek', 'mobile', 'opensource', 'agent'],
  'viral-5.en.md': ['agent', 'deepseek', 'opinion', 'mobile'],
  'viral-6.en.md': ['opensource', 'story', 'deepseek', 'node'],
  'viral-7.en.md': ['deepseek', 'productivity', 'agent', 'opensource'],
  'viral-8.en.md': ['deepseek', 'faq', 'opensource', 'agent'],
  'en-tech-deep.md': ['node', 'deepseek', 'architecture', 'websocket'],
  'en-open-source.md': ['opensource', 'story', 'deepseek'],
  'en-roadmap.md': ['opensource', 'deepseek', 'community', 'roadmap'],
};

const args = process.argv.slice(2);
const files = args.length ? args : DEFAULT_FILES;
const out = [];
for (const f of files) {
  const body = readFileSync(`docs/promotion/${f}`, 'utf8');
  const title = TITLES[f] || f.replace(/\.en\.md$/, '').replace(/[-_]/g, ' ');
  const tags = TAGS[f] || ['deepseek', 'opensource'];
  out.push({ f, title, tags, body });
}

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const { f, title, tags, body } of out) {
  const canonical_url = `https://github.com/2903077918-lgtm/DeepSeek-phone-harness/blob/main/docs/promotion/${f}`;
  let published = false;
  for (let attempt = 0; attempt < 3 && !published; attempt++) {
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'api-key': TOKEN },
        body: JSON.stringify({
          article: { title, published: true, body_markdown: body, tags, canonical_url },
        }),
      });
      const txt = await r.text();
      let j = {};
      try { j = JSON.parse(txt); } catch { /* 非 JSON（如 Retry later） */ }
      if (r.ok) { results.push({ f, ok: true, url: j.url }); console.log(`OK ${f} -> ${j.url}`); published = true; break; }
      // 限流：解析等待秒数（429 "try again in N seconds" / "Retry later"）
      let waitMs = 30000;
      const m = txt.match(/in (\d+) seconds/i);
      if (m) waitMs = Number(m[1]) * 1000 + 5000;
      else if (/rate|retry later/i.test(txt)) waitMs = 310000;
      if (/canonical/i.test(txt)) { results.push({ f, ok: false, err: txt.slice(0, 200) }); console.log(`FAIL ${f}: ${txt.slice(0, 200)}`); published = true; break; }
      console.log(`attempt ${attempt + 1} ${f}: ${txt.slice(0, 100)} -> waiting ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
    } catch (e) {
      console.log(`ERR ${f}: ${e.message} -> retrying in 60s`);
      await sleep(60000);
    }
  }
  if (!published && !results.some((r2) => r2.f === f)) {
    results.push({ f, ok: false, err: 'max attempts' });
    console.log(`FAIL ${f}: max attempts`);
  }
}
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} published`);
