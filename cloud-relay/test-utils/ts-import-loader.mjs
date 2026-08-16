// cloud-relay/test-utils/ts-import-loader.mjs
// 自定义 Node --loader：把相对导入里的 `.js` 后缀解析到同名的 `.ts`（cloud-relay 源码用 `.js` 后缀
// 写 TS 导入，Node 原生 type-stripping 不会自动把 .js 重映射到 .ts）。测试运行时通过
//   node --loader ./test-utils/ts-import-loader.mjs \
//        --experimental-strip-types test-xxx.mjs
// 加载本 loader，即可直接 import '.ts' 源码（含其 `.js` 后缀的内部导入），无需 esbuild/build。
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (e) {
    // 仅处理相对路径：把 xxx.js → xxx.ts 重试
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      if (specifier.endsWith('.js')) {
        const ts = specifier.slice(0, -3) + '.ts';
        try {
          return await nextResolve(ts, context);
        } catch (e2) {
          return Promise.reject(e);
        }
      }
    }
    return Promise.reject(e);
  }
}
