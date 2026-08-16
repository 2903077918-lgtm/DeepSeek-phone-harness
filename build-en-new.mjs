// 发布英文新文：官方公共仓库 + 自己仓库
import { readFileSync, writeFileSync } from 'node:fs';

const OFFICIAL = {
  repo: 'R_kgDOT3T1gw',
  general: 'DIC_kwDOT3T1g84DDSUb',
  plugins: 'DIC_kwDOT3T1g84DDSUe',
};
const OWN = {
  repo: 'R_kgDOT5af9g',
  general: 'DIC_kwDOT5af9s4DDc52',
  showtell: 'DIC_kwDOT5af9s4DDc55',
};

const posts = [
  { file: 'docs/promotion/en-tech-deep.md', cat: OFFICIAL.plugins, title: 'A weekend project that streams a desktop agent to your phone — with zero npm dependencies' },
  { file: 'docs/promotion/en-open-source.md', cat: OFFICIAL.general, title: 'Why I open-sourced the tool I built "just for myself"' },
  { file: 'docs/promotion/en-roadmap.md', cat: OFFICIAL.general, title: 'Where DeepSeek Phone Harness goes next — and how you can shape it' },
  { file: 'docs/promotion/en-tech-deep.md', cat: OWN.showtell, title: 'A weekend project that streams a desktop agent to your phone — with zero npm dependencies' },
  { file: 'docs/promotion/en-open-source.md', cat: OWN.general, title: 'Why I open-sourced the tool I built "just for myself"' },
  { file: 'docs/promotion/en-roadmap.md', cat: OWN.general, title: 'Where DeepSeek Phone Harness goes next — and how you can shape it' },
];

for (const [i, post] of posts.entries()) {
  const body = readFileSync(post.file, 'utf8');
  const query = `mutation {
    createDiscussion(input: {
      repositoryId: ${JSON.stringify(post.cat === OFFICIAL.general || post.cat === OFFICIAL.plugins ? OFFICIAL.repo : OWN.repo)},
      categoryId: ${JSON.stringify(post.cat)},
      title: ${JSON.stringify(post.title)},
      body: ${JSON.stringify(body)}
    }) { discussion { number url } }
  }`;
  writeFileSync(`${process.env.TEMP}/en-new-${i}.json`, JSON.stringify({ query }));
  console.log(`payload ${i} ready`);
}
console.log('done');
