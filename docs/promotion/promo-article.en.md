# DeepSeek Phone Harness: Remote-Control Your Desktop Agent from Your Phone

> Open-source project **DeepSeek Phone Harness** — the full DeepSeek Harness experience on mobile: chat, model switching, tool-call approvals, terminal, file browsing — anywhere, over 4G/5G.

---

## A familiar scene

It's 1 a.m. You're in bed. Your computer in the study is running a DeepSeek Harness task. Suddenly you want it to also do that refactor. So you get up, walk to the study, open the computer, type the instruction, watch it run, check the output, and walk back to bed — **two minutes of walking just to send one sentence**.

What if you could just pick up your phone, open a page, send the message, watch the streaming output, approve tool calls, even answer the agent's questions — and stay in bed?

That's exactly why I built **DeepSeek Phone Harness**: **DeepSeek Harness in your pocket**.

## What it is

DeepSeek Phone Harness is an open-source mobile remote-control system. It lets your phone operate DeepSeek Harness on your computer from any network (4G/5G / WiFi / public internet):

- Send tasks to your desktop agent and watch it work in **real-time streaming**
- See every **tool call**: what it did, which file it touched, and the result
- **Approve** risky operations: allow / reject
- **Answer agent questions** so tasks never hang
- **Switch models**, attach **images**, read the agent's **thinking**
- Run **terminal commands**, browse **files & code**, review **task history**
- The experience mirrors the DeepSeek Harness Web GUI

The UI follows the codex-relay design language (dark, card-based, gold whale branding), with the conversation experience aligned to DSH's native interface.

## What it feels like

### Chat, just like on your computer

Open the page and you're in a conversation: multi-turn sessions, Markdown rendering, streaming typewriter output. **Switch models** from the top (deepseek-v4-flash / v4-pro and more providers), attach **images** with the `+` button and send them to the agent.

### Every step is visible

This is the part I'm most proud of — **tool call cards**:

```
[📄 read]                        ● done
C:/Users/Joey/Documents/.../config.json   ← path at a glance
▾ tap to expand:
  arguments  {"file_path": "...", "limit": 1}
  result     <path>... 1: {
```

Icons distinguish tool types (write / read / terminal / web / subagent…), status switches live (spinner while running → green done / red failed), **the file path is shown directly**, and tapping the card reveals the full arguments and result. The agent's **thinking** is also folded up for inspection, auto-expanding while streaming.

### Approvals & questions — nothing hangs

DSH agents request authorization and ask questions. Both become cards on your phone:

- **Authorization needed**: Allow once / Reject
- **Your answer needed**: choose an option / type a custom answer / skip

Don't answer, it waits; answer, it continues — **tasks never deadlock waiting for a human**.

### Terminal, files, tasks — the whole remote kit

- **Terminal**: run commands on your computer from the phone, streaming output, full UTF-8, stoppable
- **Files / code**: browse desktop directories, view file contents
- **Task history**: review past tasks, expand output, re-run with one tap
- **Sessions**: switch workspaces, create / rename / delete / search

## What's interesting technically

- **Pure Node.js, zero dependencies**: no npm packages at all — HTTP transport + DSH Web API RPC wrapper + events.mux WebSocket relay, all Node built-ins
- **Single-file frontend**: `relay.html`, no framework, opens directly in the mobile browser
- **One WebSocket to rule them all**: approvals, questions, and session events flow through a single `events.mux` connection; the frontend polls increments for the typewriter effect
- **Optional cloud**: a Cloudflare Worker hosts the frontend + optional E2EE task channel; direct 4G/5G via Tailscale works too

## Run it in three minutes

```bash
# On the computer (requires dsh web listening on 127.0.0.1:3080)
cp config.example.json config.json   # fill in your access token
node agent.mjs --mode=both
```

On your phone open `http://<computer Tailscale IP>:8788/`, enter the address and token, pick a workspace, and go.

## Open source & welcome

MIT licensed:

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

- Star / Fork / PR are all welcome
- Roadmap: PWA offline shell, push notifications, more model shortcuts, multi-device
- Ideas? Open an issue

---

**Talking to your agent from your phone is more comfortable than you'd think.** Try it — and tell me what you did with it.
