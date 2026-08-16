# From "a thought in bed" to open source: one week of development diary

> No glamorous start — just a late-night thought. A week of building DeepSeek Phone Harness, from zero to release.

---

## Day 1 · 1 a.m., a thought

In bed that night, I realized I could have the agent on my computer run a task early. Get up and walk to the study? Too much trouble. Give up? Unsatisfying.

In that moment it hit me: **the agent's value is doing work for me, yet I'm chained to the computer.**

Next morning I opened the editor and decided to solve it myself.

## Day 2 · First version: a working "translator"

The core idea was simple: the phone sends HTTP, an agent process translates it into DSH RPC, and translates responses back.

That evening the first version worked: send a sentence from the phone, the agent on the computer executes, the result returns to the phone. **Ugly, but it moved.**

## Day 3 · Deadlocked all day: ask_user_question

On day three, tasks started "randomly hanging." I dug until late night and found: **the agent asks the user questions, questions don't go through the approval channel, and I wasn't listening to the question channel.** Tasks waited forever on a question nobody answered.

When it was fixed, my commit message said three words: "no more hangs."

## Day 4 · Make the work visible

Results weren't enough — I wanted the phone to see **what the agent does, step by step.**

So tool cards were born: one card per tool call, with icon, status, the file path it touched, and expandable full arguments and results. The agent's reasoning also folds into a collapsible block.

That night I sat watching the agent work on my phone for a long time. **"Watching it think and move" versus "waiting for a result" are two completely different experiences.**

## Day 5 · Terminal, files, tasks: from usable to useful

Added the terminal (remote commands), file browsing, task history (one-tap re-run), and session management (rename/delete/search).

## Day 6 · Polishing

- Approval and question cards inserted directly into the message stream — no context breaks
- Model picker, image attachments, thinking disclosure
- Fixed browser caching that made users "never see the new UI"

## Day 7 · Open source

Wrote the README, wrote the promo posts, pushed to GitHub. There was no ceremony — just `git push` and a long exhale.

**~4000 lines, zero npm dependencies, one Node process + one HTML file.**

## A week later, now

It runs stably: dispatch tasks on the commute, tweak config before bed, tap approvals mid-meeting. The phone became the agent's remote — **"wherever you are, your agent is too"** is no longer just a slogan.

## Try it

Open source (MIT), three-minute setup:

```bash
git clone https://github.com/2903077918-lgtm/DeepSeek-phone-harness
cd DeepSeek-phone-harness && cp config.example.json config.json
node agent.mjs --mode=both
```

Install Tailscale on the phone, access over 4G/5G.

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

**If you were to build an open-source project "for yourself," what pain point would you solve first?** Comment below — the next viral project might start here.
