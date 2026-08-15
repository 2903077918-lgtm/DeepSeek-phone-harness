# I turned my phone into a remote for DeepSeek Harness — and it changed how I use agents

> No cloud server. No public IP. No database. One Node process, one HTML file, and a 4G connection.

---

Let me ask you something: **how many times have you wanted to send a task to your desktop agent after you left the room?**

I had that moment at 1 a.m., in bed, with my computer in the study. My options were:

1. Get up, walk over, operate the computer, walk back
2. Pretend I never thought of it
3. **Use my phone**

Option 3 didn't exist. DeepSeek Harness lives on the computer; the phone can't reach it. So I spent a weekend writing an open-source project that fixed exactly that.

## What it does

**Your phone browser becomes a remote for DeepSeek Harness.**

- Send tasks, watch the agent work in **real-time streaming**
- Every tool call is visible: **which file it read, what command it ran, the result** — tap to expand full arguments and output
- Agent needs permission? An **approval card** pops up on your phone — allow once / reject
- Agent asks a question? A **question card** pops up — pick an option or type an answer
- Switch models in one tap, attach **images** with the `+` button, open a **terminal**, browse **files**, re-run **tasks**

## Why ~4000 lines

Because it has **zero npm dependencies**. No framework, no database, no `npm install`. One Node process using built-ins only: HTTP server, DSH RPC wrapper, WebSocket event relay. Clone and `node agent.mjs` — done.

The frontend is a single `relay.html` file that opens directly in your mobile browser.

## The detail that sold me

While the agent works, the phone shows **tool cards**, live:

```
[📄 read]                          ● done
C:/Users/Joey/Documents/.../config.json
▾ tap to expand: full arguments + full result
```

Not a vague "running…" — but **exactly what step is happening, which file it touches, and what came back**. Watching the agent work from bed feels almost identical to sitting at the desk.

## Try it in three minutes

```bash
git clone https://github.com/2903077918-lgtm/DeepSeek-phone-harness
cd DeepSeek-phone-harness && cp config.example.json config.json
node agent.mjs --mode=both
```

Install Tailscale (free) on both devices, open `http://<computer IP>:8788/` on your phone over 4G/5G, enter the token, go.

No public IP, no router config, no cloud server. **Three minutes.**

## Open source

MIT licensed:

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

**What would YOU want to control on your desktop agent from your phone?** Drop it in the comments — the most requested feature ships next.

A star is the cheapest and most effective way to support open source. Thank you 🫡

*(Community project, not affiliated with DeepSeek.)*
