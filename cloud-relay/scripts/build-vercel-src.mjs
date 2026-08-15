// scripts/build-vercel-src.mjs —— 生成「源码部署」目录 dist/vercel：直接放 api/*.ts + src/*.ts，
// 交给 Vercel 官方 @vercel/node builder 编译（最稳，不用自己 esbuild 猜测导出形状）。
// 用法: node scripts/build-vercel-src.mjs
import { cpSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'dist', 'vercel');

// 保留 Vercel 项目链接，别清掉
if (existsSync(join(out, '.vercel'))) {
  mkdirSync(join(out, '_v'), { recursive: true });
  cpSync(join(out, '.vercel'), join(out, '_v', '.vercel'), { recursive: true });
}
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'api'), { recursive: true });
mkdirSync(join(out, 'src'), { recursive: true });
if (existsSync(join(out, '_v'))) {
  cpSync(join(out, '_v', '.vercel'), join(out, '.vercel'), { recursive: true });
  rmSync(join(out, '_v'), { recursive: true, force: true });
}

// api 入口与 src 全部拷贝成 TS，让 Vercel 自己编译；.js 后缀经 Vercel/esbuild 解析到 .ts
cpSync(join(root, 'api', 'index.ts'), join(out, 'api', 'index.ts'));
for (const f of ['bindings', 'index', 'protocol', 'relay', 'store', 'supabase', 'types']) {
  cpSync(join(root, 'src', `${f}.ts`), join(out, 'src', `${f}.ts`));
}

writeFileSync(join(out, 'package.json'), JSON.stringify({
  name: 'cloud-relay-src',
  version: '0.1.0',
  private: true,
  type: 'module',
  engines: { node: '>=20' },
  devDependencies: {
    '@vercel/node': '^3.0.0',
    typescript: '^5.5.0',
    '@cloudflare/workers-types': '^4.20240815.0',
  },
}, null, 2));

writeFileSync(join(out, 'vercel.json'), JSON.stringify({
  $schema: 'https://openapi.vercel.sh/vercel.json',
  functions: { 'api/index.ts': { maxDuration: 10 } },
  rewrites: [
    { source: '/v1/(.*)', destination: '/api' },
    { source: '/', destination: '/api' },
  ],
}, null, 2));

// tsconfig：让 Vercel 编译时别被 workers-types 的 DurableObjectNamespace 卡住
writeFileSync(join(out, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    strict: false,
    skipLibCheck: true,
    esModuleInterop: true,
    types: ['node'],
  },
  include: ['api', 'src'],
}, null, 2));

console.log('built -> dist/vercel (源码 TS，交给 Vercel 编译)');
