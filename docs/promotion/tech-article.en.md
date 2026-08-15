# Remote-Controlling a Desktop Agent with Zero Dependencies: DeepSeek Phone Harness, Under the Hood

> No `npm install`, no framework, no database — one Node process and one HTML file, replicating the full DeepSeek Harness workflow on your phone.

---

## Intro

The [previous post](https://github.com/2903077918-lgtm/DeepSeek-phone-harness) covered what DeepSeek Phone Harness can do. This one is about **how it works** — how a zero-dependency Node.js agent lets a phone drive DeepSeek Harness on a computer from any network: streaming output, tool cards, approvals, question answers, terminal commands, all real-time.

## The design: the Agent is a translator

```
Mobile browser (relay.html)
   │  HTTPS / Tailscale (4G/5G)
   ▼
Agent (Node, 127.0.0.1:8788)          ← the only outward-facing port
   │  ┌─────────────────────────────┐
   ├─▶│ transport-lan: HTTP + auth   │   REST: /api/* + static page
   ├─▶│ executor: DSH RPC wrapper    │   session.* / workspace.* / skill.*
   ├─▶│ approval-relay: WS relay     │   events.mux, one connection
   │  └─────────────┬───────────────┘
   │                │ 127.0.0.1:3080
   ▼
DeepSeek Harness gateway (dsh web)
```

Core idea: **the Agent doesn't replace DSH — it translates protocols**. The phone speaks simple REST/JSON; the Agent translates into DSH's Web API RPC envelope (`{type:'client-request', rpcId, method, payload}`) and normalizes DSH events back into a stream the phone can consume.

## Three key modules

### 1. transport-lan: HTTP + static hosting + auth in one process

No Express — raw `node:http`. One `if` per route, uniform Bearer-token check, and `sendJson` attaches CORS headers so the page can load from any origin. The homepage returns the single-file frontend `relay.html`; **server-rendered UI and API share one port** — zero deployment config.

### 2. executor: a "session factory" over DSH RPC

Wraps a dozen DSH Web API methods:

- `session.create / prompt / history / cancel / rename / fork / models / selectModel`
- `workspace.list`, `skill.list`, `subagent.list`
- A session registry (persisted in `sessions.json`): sessions created on the phone survive restarts, so multi-turn context never breaks

Task execution is **queue-serialized**: only one task runs at a time (DSH sessions are single-writer), and the phone sees the `pending` count.

### 3. approval-relay: one WebSocket eats all realtime events

DSH's `events.mux` is a WebSocket stream carrying **three kinds** of frames:

| Frame | Purpose |
| --- | --- |
| `approval/requested` | risky operations → "authorization needed" card |
| `question/requested` | agent questions (ask_user_question) → "your answer needed" card |
| `session/event` | session deltas (chunk / tool / step) → typewriter + tool cards |

The Agent keeps one persistent WS connection and routes each kind: approvals/questions into a pending table (the phone polls `/api/approvals`, answers go back via `/api/respond`), session events into a 200-entry ring buffer per session (the phone polls `/api/events` by `seq`).

**The gotcha that matters**: `ask_user_question` does **not** go through the approval channel. If you only listen for `approval/requested`, the task hangs forever the moment the agent asks a question. Question frames must be ingested separately and forwarded, and the answer protocol must match the Web GUI exactly (`{ok:true, value:{sessionId, answer:{answers:[{id, selected}]}}}`).

## Frontend: single file, no framework

`relay.html` contains the entire UI (codex-relay design system: `#191919` background, `#C9A227` gold whale):

- **Streaming**: poll `/api/events` incrementally by seq — `text-delta` appends, `reasoning-delta` feeds the thinking disclosure, `tool-call` feeds tool cards
- **Tool cards**: every `tool/call` creates a card (keyed by callId, **file path extracted from arguments**); `tool/result` pairs by callId and flips it to "done/failed"; tap to expand full arguments and result
- **Approvals/questions**: 3-second poll of `/api/approvals`, card rendering, answer/skip posts back
- **Models/attachments**: `session.models` drives the model picker; images are compressed and submitted as image parts of `session.prompt`

## Why zero dependencies matters

The Agent uses only `node:` built-ins (http / child_process / crypto / fs). That means:

- **Deploy = copy**: `git clone` → `node agent.mjs --mode=both`, no install, no version hell
- **Auditable**: a few thousand lines; anyone can read it in 20 minutes
- **Runs anywhere Node 22+ runs**: Windows / macOS / Linux / Raspberry Pi

## Optional cloud: Cloudflare Worker

Don't want Tailscale? `cloud-relay/` is a Cloudflare Worker: it hosts the frontend static assets + an optional E2EE task channel (WebCrypto P-256 ECDH + AES-GCM — keys never touch disk). One `wrangler deploy` and it's live.

## Wrapping up

This project proves: **complex interactions don't require complex architecture**. One WebSocket, one Node process, one HTML file — and a desktop-grade agent workflow lives in your pocket.

Repo (stars / PRs / issues welcome):

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

Next post: **Run DeepSeek Phone Harness in five minutes (with Tailscale 4G/5G setup)**.
