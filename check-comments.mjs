// 查官方仓库 5 篇帖子的评论作者
import { execSync } from 'node:child_process';
const TOKEN = execSync('gh auth token', { encoding: 'utf8' }).trim();

const numbers = [2097, 2101, 2102, 2241, 2243];
const list = numbers.map((n) => `d${n}: discussion(number: ${n}) { title comments(first: 20) { nodes { author { login } createdAt body } } }`).join(' ');
const q = `{ repository(owner: "deepseek-ai", name: "deepseek-harness") { ${list} } }`;

const r = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
  body: JSON.stringify({ query: q }),
});
const data = (await r.json()).data.repository;
for (const n of numbers) {
  const d = data['d' + n];
  if (!d) continue;
  console.log(`\n#${n} ${d.title.slice(0, 40)}`);
  if (!d.comments.nodes.length) { console.log('  无评论'); continue; }
  for (const c of d.comments.nodes) {
    console.log(`  [${c.author?.login}] ${c.createdAt.slice(0, 10)}: ${c.body.slice(0, 90).replace(/\n/g, ' ')}`);
  }
}
