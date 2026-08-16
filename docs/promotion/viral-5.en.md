# The agent's next stop is your pocket: why "mobile" may be one of the agent's best forms

> We moved agents from the terminal to the browser. Now it's time to move them into your pocket. This isn't "mobile adaptation" — it's a shift in interaction paradigm.

---

DeepSeek Harness just went open source, and the community is excited — models, tools, agent loops, all pluggable. But amid the noise I noticed something:

> Everyone's discussing what agents **can do**. Almost nobody discusses **where you use them**.

Let's talk about the second one — and I'll give you my own answer.

## Agent usage is moving from "sit down" to "anytime"

First generation: open a terminal, sit down, watch.

Second generation (Web GUI): open a browser, sit down, watch.

Essentially it's still **"you must be seated at the computer."** But an agent's whole value is that it does the work *for* you — and yet you have to babysit it. Is that reasonable?

- On the commute, I want it to start running first
- Before bed, I want to assign tomorrow's tasks
- Mid-meeting, it needs an approval — I want to tap once and let it continue

All these share one trait: **you're not at the computer, but the agent is working.** Who's the remote? The phone is the only answer.

## Mobile isn't a "shrunk webpage" — it's a new paradigm

I used to think mobile = shrunk web. After actually building it, I found mobile's interaction logic is fundamentally different:

**1. From "multiple windows" to "a single timeline"**

The web has panels side by side: conversation, tool output, approval dialogs. Mobile naturally has one **vertical timeline** — user message, agent reasoning, tool cards, approval cards, question cards, all linear. The agent's work becomes a **replayable pipeline**, which is clearer, not less.

**2. From "clicking around" to "making decisions"**

On desktop you click everywhere. On mobile, thumb reach is limited, which forces interactions into **"look once → decide"**: allow this tool call or not? How to answer this question? — judgment calls, not browsing sessions.

**3. From "accompanying" to "async"**

On desktop you sit with the agent. On mobile you **dispatch → leave → come back for results.** That pushes the agent side to do state management properly (task queues, result retention, failure notifications) — which is exactly where agent products are heading.

## My answer: an open-source project that puts the agent in your pocket

Based on the above, I built [DeepSeek Phone Harness](https://github.com/2903077918-lgtm/DeepSeek-phone-harness):

- Control DeepSeek Harness on your computer from a mobile browser (4G/5G, Tailscale direct)
- Streaming output, tool cards (path/status/detail), approvals, question answers, model switching, terminal, files
- Zero npm dependencies, ~4000 lines, single-file frontend
- MIT open source, clone and run

It's no revolutionary invention — just a plain answer: **"when the agent works for you, you shouldn't have to be there."**

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

## Your turn

**What do you think is the agent's next form?**

- Mobile (a pocket remote)?
- Always-on cloud (unattended agents)?
- Something else?

Comment below — this is a topic worth arguing about.
