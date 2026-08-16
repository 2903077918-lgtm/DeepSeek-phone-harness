# DeepSeek Harness is useless when you leave the desk — so I open-sourced a way to run it over 4G

> Your desktop agent is only as good as your presence in front of the computer. Until your phone can command it.

---

Let's get this straight first: **this post is about disproving something — my own previous belief.**

I loved DeepSeek Harness. Then one day I was out and wanted the agent on my computer to organize some files. That's when reality hit:

> I'm not at the computer. The agent is a decoration.

At work. On the commute. At dinner. On the couch. **Any moment you're away from the desk, you can't use it.** Is that reasonable? No. So I built something.

## What I built

An open-source mobile remote-control project that lets your phone operate DeepSeek Harness on your computer from any network:

- **Direct 4G/5G** (via Tailscale, free) — no public IP needed
- **Real-time streaming** — the agent's words appear on your phone character by character
- **Full tool-call visibility** — which file was read, what command ran, the result — one card per call
- **Approvals + questions** — permission card pops up, question card pops up, tasks never hang
- **Model switching**, **image attachments**, **terminal**, **file browsing**

## How light is it?

**Zero npm dependencies.** ~4000 lines. Frontend is a single HTML file.

No cloud server. No database. No framework. No `npm install`. **Clone → set a token → run.**

## Real scenarios (all true)

**Scenario 1**: On the subway, opened the page, sent a task to the desktop agent. By the time I got off, the result was already on my phone.

**Scenario 2**: The agent needed permission mid-task — previously that meant waiting until I got back. Now a card pops up on my phone, I tap "Allow once", it continues.

**Scenario 3**: The agent asked me a question. I picked an option on a card. Task resumed. **A question used to mean a deadlocked task; now it's a 10-second fix.**

## Run it in three minutes

```bash
git clone https://github.com/2903077918-lgtm/DeepSeek-phone-harness
cd DeepSeek-phone-harness && cp config.example.json config.json
node agent.mjs --mode=both
```

Install Tailscale on the phone, open `http://<computer IP>:8788/`, enter the token, go.

## Honest talk

It's not perfect: it's a web page (not a native app), commands run one at a time (no full PTY), and the cloud channel needs you to deploy a Worker. **But "fully controlling your desktop agent from your phone" is done — open source and free.**

Repo (stars, PRs and issues welcome):

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

**What would YOU most want to do with your desktop agent from your phone?** Or any concerns about remote control? Drop them in the comments — I read every one.

*(Community project, not affiliated with DeepSeek.)*
