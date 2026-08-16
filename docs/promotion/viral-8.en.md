# "Remote-controlling your agent from a phone" — the 10 questions everyone asks, answered

> Collected from comments and DMs. Read this and you'll know whether this is for you.

---

Since building [DeepSeek Phone Harness](https://github.com/2903077918-lgtm/DeepSeek-phone-harness), the same 10 questions keep coming up. Let's answer them all at once.

## Q1: Is remote-controlling a desktop agent from a phone safe?

**Depends on how you use it.** The project has two layers of protection: every API requires a Bearer token, and risky operations first show an "authorization needed" card that you allow or reject on your phone. But the safety ceiling of any remote-control tool is set by your network — **use a private network like Tailscale**, and don't expose port 8788 raw to the public internet.

## Q2: Do I need a public IP? A server?

**Neither.** 4G/5G connects directly to the computer via Tailscale (free); LAN works directly. A Cloudflare Worker is optional if you want a public entry.

## Q3: How is this different from remote desktop (TeamViewer/AnyDesk)?

Remote desktop **transmits a screen** — you look at the display and move the mouse. This **transmits semantics** — instructions and results. You see the agent's reasoning, tool calls, and outcomes, not a shrunken screen. An order of magnitude less bandwidth, and far clearer on a phone.

## Q4: How much of the web experience does the phone have?

Most of it: chat, streaming, model switching, image attachments, approvals, questions, terminal, files, tasks. On a few details mobile is actually ahead: **approval/question cards inline in the message stream** (no context break), and **tool calls as a vertical timeline** (made for portrait). Heavy work (large-scale editing) still belongs at a desk.

## Q5: Do tasks hang? What if the agent asks something?

They used to — that was the biggest trap I hit. When an agent calls `ask_user_question`, an unanswered task hangs forever. Now the question becomes a "your answer needed" card: **pick an option / type a custom answer / skip.** Answer and it continues; ignore and it waits. Tasks never deadlock because "nobody's listening."

## Q6: Can I see exactly what the agent is doing?

Yes — and it's the part I'm proudest of. Every tool call is a **tool card**:

```
[📄 read]                          ● done
C:/Users/Joey/Documents/.../config.json
▾ tap to expand: full arguments + full result
```

Which file was read, what command ran, the outcome — all visible. The agent's reasoning folds into a collapsible block too.

## Q7: Is it smooth on 4G/5G?

Yes. Streaming is incremental polling — each pull only fetches a few hundred new bytes; tool cards and approval cards are lightweight JSON. The typewriter effect stays smooth on 4G in practice.

## Q8: Do I need an app? Any setup?

**No app** — the phone browser opens a page directly (PWA add-to-home-screen works). On the computer you need Node 22+ and a running DeepSeek Harness. Setup is one `config.json` with a token.

## Q9: "Zero dependencies" — really? Is deployment easy?

Really. The agent uses only Node built-ins (http / child_process / crypto / fs) — **zero npm dependencies.** Clone → set token → `node agent.mjs --mode=both`. The frontend is a single `relay.html` file.

## Q10: What's the relationship with DeepSeek official?

**Pure community project, not official.** I just believed "controlling your desktop agent from a phone" was a need someone should fill, so I filled it. Official is building Harness itself; I built its "pocket remote."

## Verdict

Is it for you? One-line test: **if you often want your agent to work while you're away from the desk — yes; if you're always at the desk — it's a nice-to-have.**

Open source (MIT):

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

**Any other questions? Ask in the comments — I reply to every one.** Popular questions will keep updating this list.
