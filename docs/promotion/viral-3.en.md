# 3 traps I fell into while letting a phone control a desktop agent — it's harder than it looks

> On the surface it's an HTTP layer and a web page. Underneath, every step fights your assumptions. Real pitfalls, so you can avoid them.

---

Before building DeepSeek Phone Harness, I assumed "mobile remote control for a desktop agent" was just moving a web page to a phone. After finishing it, I admit: **the idea took 10 minutes; the bug-fixing took a week.**

Here are 3 real traps — each one made tasks "gracefully deadlock" in production.

## Trap 1: The moment the agent asks a question, the task hangs forever

This is the nastiest one.

Our relay listened to DSH's approval channel (`approval/requested`) — all good. Until one day a test task **never finished**. Not an error — just hung, `pending` climbing.

Two days of digging later: DSH agents can call the `ask_user_question` tool to **ask the user something** — and that goes through a *different* channel (`question/requested`), **not** the approval channel. My relay only listened for approvals, so question frames were silently dropped.

Result: the agent waits on the computer for a human answer, the phone has no idea, the task hangs forever. **It only continues once the user answers.**

Fix: ingest question frames separately, forward them as "your answer needed" cards, and use the exact same answer protocol as the official Web GUI.

**Lesson: in an agent's realtime event stream, every frame type exists for a reason. Miss one, and tasks die in ways you'd never guess.**

## Trap 2: Tool results live two layers deep

The phone shows "tool cards": tool name + file path + result. Name is easy, path is easy (extract from arguments). Result?

I assumed `tool/result` content was `[{type:'text', text:'...'}]`. Naive. The real shape:

```json
content: [{
  "type": "tool-result",
  "content": [{ "type": "text", "text": "<path>...<content>..." }]
}]
```

**Two levels of nesting**, with `toolCallId` on the inner block. My first version only read one level: cards had names and paths, but results were always empty.

Fix: recursive text collection + pairing calls to results via `source.callId`.

**Lesson: no protocol doc beats capturing one real payload.**

## Trap 3: Mobile browser caching made users see a forever-old UI

Changed the UI, opened the phone — **still the old one.** Refresh, restart browser, switch browser — same.

Not a network issue. It's **caching**: the old page was cached, and `Cache-Control` wasn't set.

Fix: serve HTML with `no-store, no-cache, must-revalidate`. Every open is now the latest.

**Lesson: for mobile web apps, cache strategy matters as much as feature code.**

## Why these traps are worth sharing

Each one reveals the real complexity of "remote-controlling an agent from a phone":

- It's not a static page — it's a **faithful courier of a realtime event stream**
- It's not a toy — it must handle **approvals, questions, tool results** at production level
- It's not a demo — it must stay **low-latency, retryable, recoverable** on 4G

After fixing all of it, tool cards look like this on the phone:

```
[📄 read]                          ● done
C:/Users/Joey/Documents/.../config.json
▾ tap to expand: full arguments + full result
```

Every step the agent takes — which file, what command, the outcome — is visible. Permission requests and questions become cards. **Tasks never hang because "nobody answered."**

## The project

Open source (MIT). Stars / PRs / issues welcome:

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

**What's the weirdest bug you've hit while working with agents?** Share it below — I bet it beats mine.
