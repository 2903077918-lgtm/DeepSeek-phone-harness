# Your agent casually asked a question and froze the queue for 10 minutes — how do you all handle `ask_user_question`?

> A real pain point. I'll share my solution and the traps I hit, but I really want to hear how the community actually deals with it.

---

Quick one for everyone: **do your agents randomly stop to ask you questions? And what happens to the running task when they do?**

Here's what happened to me: DeepSeek Harness's agent calls `ask_user_question` mid-task — "should this module be sync or async?" "OK to run this high-risk command?" Sounds reasonable. But it deadlocked my **entire task queue for 10 minutes**.

## The problem: a question = a silent deadlock

The worst part: **it doesn't error.** The task just hangs there, `pending` keeps climbing, you think it's thinking — but it's actually waiting for a human answer that will never come. Because the question goes through the **question channel** (`question/requested`), which is *completely separate* from the approval channel (`approval/requested`).

My first relay only listened to approvals, so:

```
Agent stops on the computer, waiting for a user
      ↓
question-channel messages silently dropped by my relay
      ↓
phone has no idea
      ↓
task hangs forever until timeout
```

It took me two days to realize: it wasn't DSH hanging — **the question just never reached a human.**

## My fix: turn questions into "your answer needed" cards

While building [DeepSeek Phone Harness](https://github.com/2903077918-lgtm/DeepSeek-phone-harness) (remote-control your desktop agent from your phone), I made questions a **card** that drops right into the message stream:

- Agent asks → phone shows "your answer needed" card
- Pick an option / type a custom answer / skip
- Answer it and the task continues; ignore it and it waits

Protocol has to match the official Web GUI exactly (`{ok:true, value:{sessionId, answer:{answers:[{id, selected}]}}}`), or DSH won't accept it.

## What I'd really like to hear

My fix only handles the "phone side." I want the broader community's practice:

1. **Do you let agents ask you questions at all, or disable `ask_user_question`?**
2. **Granularity**: which questions are worth interrupting a human for, and which should the agent just decide?
3. **Async handling**: when a question blocks a task, what does your queue do — block, skip, or run around it?
4. Has anyone set a "question budget" per task, or use an alternative tool?

Honestly my current stance is conservative (ask only if it must, always interrupt). But I suspect that's not optimal — **"when to interrupt a human" is probably the deeper question than "how to interrupt."**

Would love to hear your practices below. And if you've had an agent-question deadlock too, drop a comment so I can gauge how common this actually is.

> Implementation is open source (MIT): https://github.com/2903077918-lgtm/DeepSeek-phone-harness
