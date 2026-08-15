// 代理注入：让 Node 程序的全局 fetch 走 127.0.0.1:7890（Vercel CLI / 其它不走 env proxy 的工具）
// 用法：NODE_OPTIONS=--require 本文件  npx vercel ...
const { setGlobalDispatcher, ProxyAgent, fetch } = (() => { try { return require('undici'); } catch { return { setGlobalDispatcher: null, ProxyAgent: null, fetch: null }; } })();

if (ProxyAgent && setGlobalDispatcher && (process.env.HTTPS_PROXY || process.env.https_proxy || 'http://127.0.0.1:7890')) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || 'http://127.0.0.1:7890';
  try {
    setGlobalDispatcher(new ProxyAgent(proxy));
    // 覆盖全局 fetch，确保 undici 走代理
    globalThis.fetch = fetch;
    if (!process.env.__PROXY_DONE) console.error('[proxy-inject] 已注入代理: ' + proxy);
  } catch (e) { console.error('[proxy-inject] 注入失败: ' + e.message); }
}
