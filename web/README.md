# phone-harness Web 控制台

自包含单文件手机网页控制台：`web/index.html`，内联 CSS/JS，无任何外部依赖，
手机浏览器直接访问可用。

## 功能清单

- **Token 管理**：输入后自动保存到 localStorage（key: `ph_token`），密码框显示，
  可点击👁切换明文；令牌为空/无效时有明确提示。
- **任务发送**：多行输入、`Ctrl / ⌘ + Enter` 快捷发送；执行中按钮禁用、转圈、
  实时耗时计时（0.1s 精度），防重复提交；空任务/空令牌拦截并聚焦对应输入框。
- **结果展示**：成功/失败分色（绿/红）、退出码、耗时；stdout 与 stderr 分块显示，
  无输出时给占位提示；一键复制完整结果（clipboard API + execCommand 降级）。
- **历史列表**：最近 20 条自动刷新（10s），每条显示任务摘要（首行截断、
  多行标注 `+N 行`）、成功/失败徽章、时间、耗时；点击可展开/收起查看完整输出。
- **连接状态**：`/api/status` 心跳（8s），顶栏胶囊绿/红/黄状态 + 粘性断连横幅，
  区分「未设置 Token / Token 无效 / 连接断开」三种情况；点击胶囊可手动重测。
- **错误处理**：401 → 「令牌无效，请检查 Token」；网络失败 → 中文提示并自动重试；
  非 2xx 响应展示服务端 error 字段。
- **移动端体验**：16px 输入字号防 iOS 聚焦缩放、44px+ 触控目标、
  `viewport-fit=cover` + safe-area 适配刘海屏、深色科技风、`prefers-reduced-motion` 降级。
- **可访问性**：`label for` 关联、按钮 `aria-label`、展开项 `aria-expanded`、
  `aria-live` 状态播报、高对比配色。

## 如何让 agent.mjs 使用它（由主 Agent 执行）

把 `agent.mjs` 第 161 行起的整个 `const INDEX_HTML = \`...\`;` 模板字符串块
替换为一行读取本文件：

```js
const INDEX_HTML = readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
```

`readFileSync` 与 `path` 已在 `agent.mjs` 顶部导入，无需新增 import。
替换后重启 Agent 即可：`GET /` 将返回本文件内容。

## 本地预览（可选，仅开发用）

```powershell
python -m http.server 9000 --directory web
```

浏览器打开 `http://127.0.0.1:9000` 即可预览 UI（API 请求会失败属正常，
需连接运行中的 Agent 才有数据）。

## 调试

页面脚本暴露 `window.__consoleApp`（`runTask / checkStatus / loadHistory /
renderResult / copyResult / api / saveToken / fmtElapsed`），可在浏览器控制台
直接调用进行手工验证。
