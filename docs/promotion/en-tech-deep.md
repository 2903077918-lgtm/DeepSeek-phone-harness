# A weekend project that streams a desktop agent to your phone — with zero npm dependencies

> One WebSocket, one Node process, one HTML file. Here's the architecture behind DeepSeek Phone Harness, and the three decisions that made it work.

---

Last weekend I built [DeepSeek Phone Harness](https://github.com/2903077918-lgtm/DeepSeek-phone-harness) — a mobile remote for DeepSeek Harness. The constraint I set myself: **zero npm dependencies**. Not because I'm a purist, but because a tool like this should be "clone and run," not "install 47 packages and hope."

Here's the architecture that made it work.

## One process, three responsibilities

```
Phone browser (relay.html)
   │  HTTPS / Tailscale
   ▼
Agent (Node, :8788)  ── http server + static page + WS relay
   │ 127.0.0.1:3080
   ▼
DeepSeek Harness gateway (dsh web)
```

The Agent is a translator, not a replacement: it speaks REST to the phone and RPC to DSH.

## Decision 1: one WebSocket for all realtime events

DSH exposes `events.mux` — a WebSocket stream carrying approvals, questions, and session events in one pipe. Instead of opening one connection per concern, I keep **one persistent connection** and route frames locally:

| Frame | Goes to |
| --- | --- |
| `approval/requested` | pending table → phone approval cards |
| `question/requested` | pending table → phone answer cards |
| `session/event` | ring buffer (200/session) → phone stream polling |

The phone polls `/api/events?afterSeq=N` — each poll returns only new bytes, which keeps 4G streaming smooth.

## Decision 2: the question channel is NOT the approval channel

The single most important bug I fixed: DSH agents call `ask_user_question` through a **separate channel** from approvals. If you only listen for `approval/requested`, the moment the agent asks something the task deadlocks *forever* — it's waiting for a human answer that the phone never shows.

The answer protocol had to match the Web GUI exactly:

```json
{ "ok": true, "value": { "sessionId": "...", "answer": { "answers": [{ "id": "q1", "selected": ["..."] }] } } }
```

## Decision 3: tool calls become cards keyed by callId

Every `tool/call` event creates a tool card (name, icon, status, **file path extracted from arguments**). Every `tool/result` pairs back by `callId` and flips the card to done/failed. Tapping expands the full arguments and result.

One trap: DSH's `tool/result` content is **double-nested** (`content[].content[].text`) — my first version read one level too shallow and results came back empty. Lesson: capture a real payload before trusting any schema.

## The result

- ~4000 lines, zero dependencies
- Single-file frontend (`relay.html`)
- Streaming typewriter, tool cards, approval/answer cards, model switching, terminal, file browser
- 4G/5G via Tailscale, no public IP

## Why this matters

"Phone remote for a desktop agent" sounds like it needs a platform team. It doesn't. The barrier to entry for this whole category just collapsed — **anyone with Node 22+ can build or extend one in a weekend.**

The code is open (MIT):

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

Questions about the architecture? Happy to go deeper in the comments.
