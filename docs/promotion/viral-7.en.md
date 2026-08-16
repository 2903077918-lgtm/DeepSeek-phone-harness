# The 5 agent tasks I most often run from my phone: a real list

> No concepts — a list. These are real tasks I dispatched to my desktop agent from my phone over the past week.

---

After building [DeepSeek Phone Harness](https://github.com/2903077918-lgtm/DeepSeek-phone-harness), I developed a habit: **anything that can be done on the phone, never get up and walk to the study.** Here's last week's real log.

## Task 1: Dispatch on the commute, collect the result on arrival

Most used. On the subway, open the phone, send "list the 5 largest files in downloads, sorted by size." Get off and read the answer.

**Phone experience**: send, lock screen. The agent runs slowly on the computer; I sway slowly on the train. Tool cards show it running `dir`, `du` — every step in plain sight.

## Task 2: Tweak config before bed, find it verified in the morning

At night, in bed, send "change the timeout in config to 30 seconds, then run the tests." Next morning the tests are done, conclusion waiting on the phone.

**Why on the phone**: because I'm turning off the lights. If this task required the computer, I'd probably procrastinate it into oblivion.

## Task 3: Tap approvals mid-meeting

The agent needs authorization mid-task — previously that meant waiting until I was back at the desk. Now a "authorization needed" card pops up, **thumb taps "Allow once"**, it continues.

**Best moment**: a colleague at the same table asked what I was doing in the meeting. "Greenlighting my desktop agent."

## Task 4: Quick code lookups from the couch

Lying on the sofa, wanting to confirm whether a certain function exists in a file. Before: get up → study → open editor → search → come back. Now: phone → file browser → read → keep lying down.

**Tool cards shine here**: when the agent searches code, cards show exactly which file it's reading, path at a glance.

## Task 5: Model comparison experiments

Want to compare deepseek-v4-flash vs v4-pro on the same task — tap the model name at the top, switch, re-send, compare side by side.

**Before**: edit CLI config, restart, retry. **Now**: two taps.

## The common thread

All five tasks share one trait: **none of them require you to be at the computer.** They only need:

1. Send an instruction
2. See the process
3. Make decisions at key moments (approvals/questions)
4. Collect the result

The phone happens to provide all four. And "not being at the computer" is exactly the most overlooked part of the agent experience.

## The toolkit

Open source (MIT):

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

- Direct 4G/5G (free Tailscale), three-minute setup
- Streaming output, tool cards (path/status/detail), approvals, question answers, model switching, terminal, files
- Zero npm dependencies, single-file frontend

**Which agent tasks would you want to do from your phone?** List them — the most requested ones ship next.
