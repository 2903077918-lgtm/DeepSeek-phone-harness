# 一个 4000 行的 Node 脚本，让我的手机变成了 DeepSeek Harness 的遥控器

> 没有云服务器，没有公网 IP，没有数据库。只有一个 Node 进程 + 一个 HTML 文件。以及，4G 网络。

---

先问一句：**你有没有在离开电脑后，突然想给电脑上的 Agent 派个活？**

我有。而且是深夜。

凌晨一点，我躺在床上，想到一个可以让任务早点跑完的操作。当时的选项是：

1. 爬起来，走去书房，操作电脑，再走回来
2. 假装没想起来，明天再说
3. **掏出手机**

选项 3 以前是不存在的——DeepSeek Harness 跑在电脑上，手机够不着。直到我花了一个周末，写了一个 4000 行代码的开源项目，把这个问题彻底解决了。

## 它做了什么

简单说：**你的手机浏览器，变成了 DeepSeek Harness 的遥控器。**

- 发任务，**实时流式**看 Agent 干活
- 每一步工具调用都看得见：**读了哪个文件、改了哪行代码、跑了什么命令**，点开还能看完整参数和结果
- Agent 要权限？手机上弹「需要授权」，允许/拒绝一键决定
- Agent 反问？手机上弹「需要你回答」，选选项或直接打字
- 想换模型？顶部点一下，deepseek-v4-flash / v4-pro 随便切
- 想发截图给 Agent 分析？输入框旁边 `+` 添加图片
- 终端、文件浏览、任务重跑……全都有

## 为什么是 4000 行

因为它**零依赖**——没有 `npm install`，没有框架，没有数据库。一个 Node 进程用内置模块完成了全部：HTTP 服务、DSH RPC 封装、WebSocket 事件中继。克隆下来直接 `node agent.mjs` 就能跑。

前端也是单文件 `relay.html`，手机浏览器打开即用。

## 最打动我的一个细节

Agent 在工作时，手机上会实时出现一张张**工具卡片**：

```
[📄 read]                          ● 完成
C:/Users/Joey/Documents/.../config.json
▾ 点击展开：完整参数 + 完整结果
```

它不是"正在执行…"这种敷衍提示，而是**每一步具体在做什么、动哪个文件、结果如何**。躺在床上看 Agent 干活，和坐在电脑前看，体验几乎一致。

## 怎么用

```bash
# 电脑上（已装 DeepSeek Harness）
git clone https://github.com/2903077918-lgtm/DeepSeek-phone-harness
cd DeepSeek-phone-harness && cp config.example.json config.json
node agent.mjs --mode=both
```

手机装个 Tailscale（免费），4G/5G 下直接访问 `http://<电脑IP>:8788/`，填令牌，开工。

全程不需要公网 IP、不需要路由器配置、不需要云服务器。**三分钟，搞定。**

## 最后

项目已开源（MIT）：

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

**评论区聊聊：你希望手机远程控制电脑上的 Agent 帮你做什么？** 呼声最高的功能我下一版优先做。

Star 是对开源最大的支持，先谢过 🫡
