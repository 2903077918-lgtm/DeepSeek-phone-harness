# 我用 31 秒讲清楚了一件事：手机，就是 Agent 最好的遥控器

> DeepSeek Phone Harness 宣传片上线了。31 秒，8 个镜头，讲一件事：**手机控制电脑。**

---

## 先看片

**🎬 [DeepSeek Phone Harness · 31s 宣传片](https://github.com/2903077918-lgtm/DeepSeek-phone-harness)（仓库里取 `video/remotion/out/promo.mp4`）**

> 深夜里，一个发着金光的手机屏幕浮起。消息在屏幕上逐字出现，工具卡片一张张飞入——read 哪个文件、跑什么命令、完成还是失败，全都看得见。Agent 提问，手机弹卡回答；模型切换，拇指一滑。最后，手机与电脑在深空网络中连成一线：**Phone in hand. Computer at your command.**

这支片子用 video-shotcraft 制作——152 张镜头配方卡里挑的：墨线品牌开场、贴面游走、卡片发牌、线条接力转场、3D 终端、俯瞰文件、分段控件、深空收尾。全部真实截图 + 虚构演示数据，31 秒 8 镜。

## 这支片子在讲什么

一句话：**手机，是 Agent 最好的遥控器。**

很多人用 Agent 的方式是"坐在电脑前盯着它干活"。但 Agent 的价值恰恰是替你干活——活是它干的，你却要一直陪着它，这不合理。

- 通勤路上想派个活：**掏出手机**
- 躺床上想让它先跑起来：**掏出手机**
- 开会时它要个授权：**掏出手机，点一下**
- 出门在外想看它干到哪了：**掏出手机**

手机端不是网页的缩小版，是另一种交互范式：审批、提问、工具卡片直接插在消息流里，拇指就是鼠标，Agent 的每一步都看得见。

## 为什么值得看一眼

- **零 npm 依赖**：一个 Node 进程 + 一个 HTML 文件，克隆即跑
- **4G/5G 直连**：Tailscale 免费，不用公网 IP
- **工具卡片带路径**：read 哪个文件、改了什么、结果如何，点开全看
- **审批/提问不卡死**：Agent 反问时手机弹卡，答完继续
- **开源 MIT**：4000 行，欢迎 Star / PR / Issue

## 三分钟跑起来

```bash
git clone https://github.com/2903077918-lgtm/DeepSeek-phone-harness
cd DeepSeek-phone-harness && cp config.example.json config.json
node agent.mjs --mode=both
```

手机 Tailscale 连上电脑，打开 `http://<电脑IP>:8788/`，开工。

---

**"人在哪，Agent 就在哪。"** ——这不是广告语，是我过去两周的真实状态。

仓库：**https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

*评论区聊聊：你希望手机替你控制电脑上的 Agent 做什么？*
