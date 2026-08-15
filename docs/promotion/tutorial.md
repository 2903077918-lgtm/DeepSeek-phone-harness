# 五分钟把 DeepSeek Phone Harness 跑起来：手机 4G 远程控制电脑

> 从零到手机遥控电脑上的 DeepSeek Harness，只要五步。全程不需要公网 IP，不需要路由器配置。

---

## 你需要准备

| 东西 | 说明 |
| --- | --- |
| 电脑 | Windows / macOS / Linux 均可，已装 Node.js 22+ |
| DeepSeek Harness | 电脑上跑着 `dsh web`（监听 `127.0.0.1:3080`） |
| 手机 | 任意手机浏览器（Safari / Chrome） |
| Tailscale | （可选）手机 4G/5G 直连电脑的钥匙，免费 |

## 第 1 步：电脑上克隆并配置

```bash
git clone https://github.com/2903077918-lgtm/DeepSeek-phone-harness.git
cd DeepSeek-phone-harness

# 生成配置文件（模板不含任何密钥）
cp config.example.json config.json
```

用编辑器打开 `config.json`，把 `token` 字段改成你自己的访问令牌（一串随机字符串，比如用 `openssl rand -hex 24` 生成）。

## 第 2 步：启动 Agent

```bash
node agent.mjs --mode=both
```

看到这个就说明 OK：

```
deepseekharness-relay Agent v0.4.0
 控制台: http://<本机IP>:8788
 Token:  <你的访问令牌>
```

## 第 3 步：手机与电脑组网（4G/5G 也能用）

两种方式任选：

**方式 A：Tailscale（推荐，4G/5G 直连）**

1. 电脑和手机都装 Tailscale，登录同一个账号
2. 手机打开 `http://<电脑的Tailscale IP>:8788/`
   - Tailscale IP 长这样：`100.x.x.x`，在电脑上 `tailscale ip` 可查
3. 手机在 4G/5G 网络下也能直接访问这个 IP——**不需要 WiFi**

**方式 B：同一 WiFi（局域网）**

手机连电脑同一个 WiFi，打开 `http://<电脑局域网IP>:8788/` 即可。

## 第 4 步：手机连接

1. 打开页面后，输入：
   - **服务器地址**：`http://<电脑IP>:8788`
   - **访问令牌**：`config.json` 里填的那个
2. 点「连接」→ 选择工作区 → 进入对话

## 第 5 步：开干

试试这些：

- 发任务：`帮我把 downloads 文件夹里最大的 3 个文件列出来`
- 看它干活：工具卡片实时显示**读取了哪个文件、执行了什么命令**，点卡片看完整参数和结果
- 批准/回答：Agent 请求授权或反问时，卡片会出现在消息流里，允许/拒绝/回答都行
- 换模型：点顶部模型名，切换 deepseek-v4-flash / v4-pro
- 跑终端：抽屉里打开「终端」，直接执行电脑命令
- 翻代码：抽屉里「文件」，浏览电脑上的项目

## 常见问题

**Q：手机打不开页面？**
A：确认电脑 8788 端口在监听（启动日志有打印）；Tailscale 模式下确认两台设备都在线。

**Q：任务一直"执行中"没反应？**
A：看消息流里有没有「需要你回答」的卡片——Agent 可能正在等你回答，回答完它就会继续。

**Q：想公网访问（不装 Tailscale）？**
A：用 Cloudflare Worker 方案（`cloud-relay/` 目录，`wrangler deploy` 即可），或自行反代并务必开启 Token 鉴权。

**Q：换新令牌？**
A：改 `config.json` 的 `token` 后重启 Agent，手机端在设置里「修改连接」重新填。

## 安全提醒

- `config.json` 不要提交到任何公开仓库（项目已把它加入 `.gitignore`）
- 8788 端口只对可信网络开放；公网暴露务必加反代 + 强 Token
- 所有危险操作都会先弹审批卡，由你决定是否放行

---

跑起来之后，欢迎来仓库交流：

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

觉得有用的话点个 Star，就是最大的支持。
