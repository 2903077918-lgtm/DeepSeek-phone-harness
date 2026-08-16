// 汇总宣传互动数据：GitHub Discussions + dev.to
import { execSync } from 'node:child_process';

const TOKEN = execSync('gh auth token', { encoding: 'utf8' }).trim();
const DEVTO = 'JpTJ2hU4f8N8CgVU3h8mhTML';

const gql = async (query) => {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return (await r.json()).data;
};

const q = `{
  a: repository(owner: "2903077918-lgtm", name: "DeepSeek-phone-harness") { discussions(first: 50) { nodes { number title comments { totalCount } } } }
  b: repository(owner: "deepseek-ai", name: "deepseek-harness") { discussions(first: 80) { nodes { number title comments { totalCount } } } }
}`;

const data = await gql(q);

console.log('=== 自己仓库 DeepSeek-phone-harness ===');
let myTotal = 0;
for (const d of data.a.discussions.nodes) {
  if (d.comments.totalCount > 0) { myTotal += d.comments.totalCount; console.log(`#${d.number} [${d.comments.totalCount}评] ${d.title.slice(0, 50)}`); }
}
console.log(`评论总数: ${myTotal} / ${data.a.discussions.nodes.length} 篇`);

console.log('\n=== 官方仓库 deepseek-ai/deepseek-harness ===');
let offTotal = 0, offWith = 0;
for (const d of data.b.discussions.nodes) {
  if (d.comments.totalCount > 0) { offTotal += d.comments.totalCount; offWith++; console.log(`#${d.number} [${d.comments.totalCount}评] ${d.title.slice(0, 55)}`); }
}
console.log(`评论总数: ${offTotal} / ${data.b.discussions.nodes.length} 篇（${offWith} 篇有评论）`);

console.log('\n=== dev.to ===');
try {
  const r = await fetch('https://dev.to/api/articles/me/published?per_page=100', { headers: { 'api-key': DEVTO } });
  const arts = await r.json();
  let v = 0, rct = 0, cmt = 0;
  for (const a of arts) { v += a.page_views_count || 0; rct += a.public_reactions_count || 0; cmt += a.comments_count || 0; }
  console.log(`文章 ${arts.length} 篇 | 总浏览量 ${v} | 总点赞/反应 ${rct} | 总评论 ${cmt}`);
  const top = [...arts].sort((x, y) => (y.page_views_count || 0) - (x.page_views_count || 0)).slice(0, 5);
  for (const a of top) console.log(`  👁 ${a.page_views_count || 0} ❤ ${a.public_reactions_count || 0} 💬 ${a.comments_count || 0} | ${a.title.slice(0, 55)}`);
} catch (e) { console.log('dev.to 查询失败:', e.message); }
