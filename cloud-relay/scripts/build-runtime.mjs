// scripts/build-runtime.mjs —— 把 cloud-relay 打包成自包含的 Vercel Node 函数（单文件，无需部署时编译）
// 产出: dist/runtime/api/index.js （esbuild 内联全部 src/*.ts）+ dist/runtime/package.json + vercel.json
// 注意：不删除目录，避免清掉 dist/runtime/.vercel 链接（Vercel 项目链接）。
// 用法: node scripts/build-runtime.mjs
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'dist', 'runtime');

mkdirSync(join(out, 'api'), { recursive: true });

async function main() {
  await build({
    entryPoints: [join(root, 'api', 'index.ts')],
    outfile: join(out, 'api', 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',            // Vercel Node 函数用 CommonJS 最稳（.default 导出）
    target: 'node20',
    sourcemap: false,
    logLevel: 'silent',
  }).catch((e) => { console.error('esbuild failed:', e.message); process.exit(1); });

  writeFileSync(join(out, 'package.json'), JSON.stringify({
    name: 'cloud-relay-runtime',
    version: '0.1.0',
    private: true,
    type: 'commonjs',
    engines: { node: '>=20' },
  }, null, 2));

  writeFileSync(join(out, 'vercel.json'), JSON.stringify({
    $schema: 'https://openapi.vercel.sh/vercel.json',
    functions: { 'api/index.js': { maxDuration: 10 } },
    rewrites: [
      { source: '/v1/(.*)', destination: '/api' },
      { source: '/', destination: '/api' },
    ],
  }, null, 2));

  console.log('built -> dist/runtime (api/index.js + package.json + vercel.json)');
}

main();
