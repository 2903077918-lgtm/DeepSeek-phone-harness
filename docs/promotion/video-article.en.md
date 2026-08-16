# We made a 31-second promo to say one thing: your phone is the best remote for your agent

> The DeepSeek Phone Harness promo is live. 31 seconds, 8 shots, one message: **your phone controls your computer.**

---

## Watch it first

**🎬 [DeepSeek Phone Harness · 31s promo](https://github.com/2903077918-lgtm/DeepSeek-phone-harness)** (grab `video/remotion/out/promo.mp4` from the repo)

> In the dark, a phone screen glows gold. Messages type out on it. Tool cards fly in — which file was read, what command ran, done or failed, all visible. The agent asks a question; a card pops up for the answer. Model switching is a thumb-swipe. Finally, phone and computer connect across deep space: **Phone in hand. Computer at your command.**

Made with video-shotcraft — picked from 152 shot recipe cards: ink crosshair opening, graze-face tour, card dealing, line-carry transition, 3D terminals, overhead file reveal, segmented control, deep-space outro. Real screenshots, fictional demo data, 31 seconds, 8 shots.

## What the promo is really about

One sentence: **the phone is the best remote for your agent.**

Most people use agents by sitting at the computer watching them work. But the whole point of an agent is that it does the work *for* you — and yet you have to babysit it. That's backwards.

- On the commute, want to dispatch a task: **phone**
- In bed, want it to start running: **phone**
- Mid-meeting, it needs approval: **phone, one tap**
- Away from the desk, want to check progress: **phone**

Mobile isn't a shrunken web page — it's a different paradigm: approvals, questions, and tool cards inline in the message stream, your thumb as the mouse, every step of the agent visible.

## Why it's worth a look

- **Zero npm dependencies**: one Node process + one HTML file, clone and run
- **Direct 4G/5G**: free Tailscale, no public IP
- **Tool cards show paths**: which file was read, what changed, the result — tap to expand
- **No deadlocks**: the agent asks → a card pops up → answer → it continues
- **MIT open source**: ~4000 lines, stars/PRs/issues welcome

## Run it in three minutes

```bash
git clone https://github.com/2903077918-lgtm/DeepSeek-phone-harness
cd DeepSeek-phone-harness && cp config.example.json config.json
node agent.mjs --mode=both
```

Install Tailscale on the phone, open `http://<computer IP>:8788/`, go.

---

**"Wherever you are, your agent is too."** — not a tagline. It's been my real life for two weeks.

Repo: **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

*What would YOU make your desktop agent do from your phone? Comments open.*
