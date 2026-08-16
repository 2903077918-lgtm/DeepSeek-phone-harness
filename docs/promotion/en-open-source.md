# Why I open-sourced the tool I built "just for myself"

> It started as a selfish project: a phone remote for my own desktop agent. Three reasons made me push it public. The third one surprised me.

---

I built [DeepSeek Phone Harness](https://github.com/2903077918-lgtm/DeepSeek-phone-harness) for one reason: I was in bed at 1 a.m., wanted to send a task to the agent on my computer, and refused to get up. Pure selfishness.

It worked so well that I kept using it. And then I had to decide: keep it private, or open it up?

## Reason 1: the bug that cost me two days deserves a warning sign

The hardest bug — the one that made tasks hang forever — was invisible until you knew it existed: **DSH's agent-question channel is separate from its approval channel.** Miss it, and every `ask_user_question` call deadlocks your pipeline silently.

There's no way to discover this by reading docs. You have to capture a real event stream, notice a frame type nobody told you about, and chase it for two days. **That kind of hard-won knowledge should be public** — someone else shouldn't have to re-pay that tuition.

## Reason 2: the pattern deserves to be copied

"Phone as a remote for a desktop agent" is a genuinely useful pattern. But right now it lives in scattered, platform-specific implementations. An MIT-licensed, zero-dependency reference implementation lowers the floor: anyone can clone it, read ~4000 lines, and build their own — for DeepSeek Harness, or any agent runtime with a similar event model.

## Reason 3 (the surprise): it changed how I write code

Open-sourcing it forced me to do things I wouldn't have bothered with otherwise:

- Remove secrets from history (filter-branch, .gitignore — my token never touches GitHub)
- Write real docs and onboarding instead of "works on my machine"
- Structure the code so a stranger could read it
- Take feedback as a feature list instead of a threat

**The tool got better in the week after open-sourcing than in the week before.** That surprised me, and it's the reason I'll keep building in public.

## What I ask in return

Nothing, really. But if you take one thing: **when you fix a nasty bug nobody warned you about, write it down and put it where others can find it.** That's the entire spirit of this project.

Repo (MIT, zero dependencies, three-minute setup):

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

*Have you open-sourced something you built "for yourself"? What changed? I'd genuinely like to know.*
