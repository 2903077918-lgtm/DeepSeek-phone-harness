# DeepSeek Phone Harness · 宣传片设计 Spec（自主自由创作）

模式：自主自由创作（已确认）。~20.4s / 1920×1080 / 30fps / 竖屏手机 UI 展示 + 2.5D 运镜。
**核心叙事（贯穿全片）：手机控制电脑 —— "Phone in hand, computer at your command."**
画面镜头 / 字幕 / 结尾三层面都必须传达"手机遥控电脑上的 Agent"这一项目意义。

## 阶段 0 · 产品简报

- 产品：DeepSeek Phone Harness——手机远程控制电脑上 DeepSeek Harness 的开源工具
- 卖点：① 4G/5G 任意网络直连（Tailscale）② 工具调用全程可见（卡片：图标+路径+状态+详情）③ 审批/提问卡不卡死 ④ 模型切换/图片附件/终端/文件
- **项目意义（必须表达）：手机是遥控器，电脑上的 Agent 是执行者——"人在哪，Agent 就在哪"**
- 受众：开发者 / AI Agent 用户
- 语言：英文主字幕 + 中文副字幕（国内外双受众）
- 画幅：16:9（1920×1080）；产品页面以手机竖屏 393×852 截图 + 2.5D 相机呈现
- 数据口径：**全部使用虚构演示数据**（假会话标题/假路径/假消息），真实 token/路径/会话绝不入镜

## 阶段 1 · 视觉方向与 tokens

方向：**「深夜书房里的金色鲸鱼」**——暗场（近黑 #0B0C10→#191919 渐变）中，一个发着金光的手机屏幕浮起，页面交互实时发生，最后手机与电脑在深空网络中相连。动效性格：**专业信赖 × 一点科技感**（能量中低、落地稳定、单点金色光效克制使用）。

- 背景：#0B0C10 → #191919 径向渐变（镜头 1/3/5 用暗金属径向 #131318→#0B0C10，带微弱拉丝）
- 产品色（来自 relay.html）：surface #2A2A2A、selected #383838、text #F2F2F2、secondary #9A9A9A、blue #3E96FF、green #6BBF59、red #D84F4F、**gold #C9A227（品牌主强调，仅此一种高亮）**
- 字体：中文 PingFang SC / 微软雅黑；英文 SF Pro / Inter；代码/路径 ui-monospace "Cascadia Code"
- 动效 tokens：入场 bezier(0.16,1,0.3,1) ~21f、不弹（专业信赖）；相机推进 easeInOutCubic；卡片落位轻微 settle（y1=1.06 单次）；hold 规则：品牌落定 ≥30f、批量收尾 ≥15f 静止
- 光：单点金色 key-light + 微弱冷色 rim；禁 glint 群发

## 阶段 2 · 功能到镜头映射

| 功能 | 首选卡 | 备选 | 依据 |
|---|---|---|---|
| 开场品牌（用户指定） | **brand-ink-open** | spotlight-hero-card | 墨线十字准星+字标压印+hold 1s |
| 对话流式（用户指定） | **graze-face-tour** | typewriter-moves | 贴面游走，消息文字悬浮→贴落（UI 当地形） |
| 工具卡片 | deck-deal-flyin | list-reveal | 卡片发牌=工具调用的物理隐喻（核心卖点） |
| 转场（用户指定） | **line-carry-transition** | — | 全片唯一招牌转场：进度条→提问卡框 |
| 审批/提问 | chip-grid-single-select-blackout | card-flip-reveal | 选项点亮（并入转场尾部） |
| 模型切换（用户指定） | **segmented-thumb-hero** | picker-carousel-feature-cycle | 分段控件 thumb 特写 |
| 收尾 | global-network-orbit-outro | ui-to-brand-morph | 手机与电脑深空相连+品牌收尾 |

## 阶段 3 · 分镜表（~20.4s = 611f @30fps）

### 画面镜头层（手机控制电脑的视觉表达）
- **手机是唯一主角**：S2/S3 手机竖屏 UI 以"贴面/发牌"呈现，手机外壳（圆角边框+金色描边）始终可见，暗示"这一切发生在手机上"
- **电脑是被控制者**：S3 工具卡展示"电脑上的文件路径/命令"（read → C:/Users/demo/My-Project/config.json），字幕强调"电脑上的 Agent 在执行"
- **连接可视化**：S6 深空网络中，手机节点与电脑节点之间金色连线脉冲流动——"手机 ↔ 电脑"的物理连接；4G/5G 信号波纹点缀

### 字幕层（每镜都点题）

| # | 时间(f) | 主字幕（英） | 副字幕（中） | 关键动效 | 素材 | SFX |
|---|---|---|---|---|---|---|
| S1 | 0-83 | brand-ink-open：准星→字标→kicker "REMOTE CONTROL FOR DEEPSEEK HARNESS" hold 1s | 墨线准星描画→字标逐字压印→hold 46-76f→退场 | 纯品牌 | transition-soft + whoosh |
| S2 | 83-203 | "Your agent. On your phone." | "手机遥控电脑上的 Agent" | graze-face-tour 贴面游走：消息/工具卡文字悬浮→错峰贴落 | 对话页全页+切片 | whoosh + text pops |
| S3 | 203-291 | "Watch every step on the computer" | "电脑上的每一步，手机上看得见" | deck-deal 发牌：read/pwsh 工具卡落位，结尾进度条走满（转场起点） | 工具卡切片+进度条 | whoosh + deal pops |
| T1 | 291-411 | "Answer. Don't wait." | "回答它，别干等" | line-carry-transition：进度条延伸→横移→围出提问卡框→内容淡入→静止36f | 提问卡框+选项 | 笔擦+轻叩 |
| S4 | 411-561 | "Your computer, at your fingertips" | "电脑，就在指尖" | terminal-3d：三终端窗散布 3D，相机穿窗飞行，到窗打字敲命令、结果逐行滑出 | 终端页全页+输出行切片 | whoosh + mech + typing |
| S5 | 561-681 | "Your files, in your pocket" | "文件，随身带走" | overhead-camera-moves（A 式 tilt-reveal）：文件树整页 rotateX 平躺→机位回正，内容一排排涌入 | 文件页全页+行切片 | whoosh + paper |
| S6 | 681-791 | "Models, one tap away" | "模型，一点即换" | segmented-thumb-hero：分段控件特写，thumb 8f 滑动+图标弹出 | 手搓分段控件 | ui switch + pop |
| S7 | 791-931 | "Phone in hand. Computer at your command." | "手机在手，电脑随行" | 深空地球：手机节点↔电脑节点金色连线脉冲→鲸鱼→标语落定 hold | 品牌 logo+文本 | riser→impact→sparkle |

### 结尾层（点题收束）
S7 收尾序列：深空地球弧面 → 手机节点与电脑节点出现，金色连线脉冲流动（连接可视化）→ 4G/5G 波纹 → 金色鲸鱼 logo 落定 → 主标语 **"Phone in hand. Computer at your command."** + 副标语 **"手机控制电脑 · DeepSeek Phone Harness"** → 仓库链接 `github.com/2903077918-lgtm/DeepSeek-phone-harness` → 全片音量峰值 impact + sparkle 余韵，hold ≥1s。

> 全片 931f ≈ 31s。终端/文件为"手机控制电脑"核心意义镜头；tagline 各镜只出现一次，无重复。

## 阶段 4+ 计划（后续执行）

- 素材：playwright 截 relay.html 手机视口（393×852, dsf=2）三件套 + 元素抠图 + layout.json；**注入虚构演示数据**（假标题/路径/消息）
- 工程：copy `template/` 到 `video/remotion/`，`assets/lib/` 组件 copy 进来；PageCam 2.5D 地基
- 声音：BGM 从 `assets/audio/bgm/` 选 tech-house；SFX 按上表；终渲两版（带/无 BGM）
- 终检：独立 subagent 按 final-review.md + aesthetic-rules.md 审查

## 关键判例（防返工）

- 落地要弹的 y1>1；品牌落定 hold≥30f；批量动效收尾 15f 静止
- 页面复刻必须真实截图 + 2x 纹理 + layout.json；手搓仅限抽象品牌段
- 确定性渲染：无 Date.now/Math.random，固定种子
- 数据脱敏：所有展示会话/路径/消息为虚构
