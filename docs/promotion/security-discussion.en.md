# Remote-controlling the agent on your computer from your phone: what security traps worry you most?

> An open security discussion. I'll share four real concerns I've hit or thought about. I want your fuller list — I'm sure there's stuff I haven't thought of.

---

Remote control has always been a tug-of-war between "convenient" and "safe." After turning my phone into a remote for the agent on my computer, I've put together a few **real** security concerns and would love to hear your complete checklist — there's definitely things I'm missing.

## Three I've handled so far

Building [DeepSeek Phone Harness](https://github.com/2903077918-lgtm/DeepSeek-phone-harness) (drive your desktop agent from your phone over 4G/5G), I dealt with at least three layers:

1. **Token auth**: every endpoint requires `Authorization: Bearer`; the token lives in a local `config.json`, never in any repo (I scrubbed history once already).
2. **Approval cards**: before the agent does something risky (writing files, running commands) → a "authorization needed" card pops on the phone; allow/reject is a human decision. I believe this is the **floor** for remote control — when you're not at the computer, authorization has to be interceptable.
3. **Network isolation**: recommend Tailscale private-network direct access, don't expose the port raw to the public internet; if public, go through a reverse proxy + strong token.

## The ones I'm honestly unsure about

These have no clear answer from me yet — open to being corrected:

- **MITM on 4G/5G**: Tailscale encrypts, but if exposed without it, is a bearer token over HTTP acceptable?
- **Agent privilege boundary**: an approval card can only block what I *know* to block. Could an agent chain harmless steps into a harmful outcome (read a bunch of files, then quietly write one)?
- **Lost phone**: unlocked phone = control over your desktop agent. Should there be a second factor / device PIN / expiring tokens?
- **Prompt injection on the model**: if I feed the agent a crafted prompt, could it run something unexpected? How granular should permissions really be?

## What I most want from you

A good security checklist for remote control is something the community knows better than one person. Let's hear:

1. When you remote-control your own computer, **which class of risk worries you most**?
2. Besides "authorization interception", what mechanism do you consider **essential**?
3. What's your **one-line objection** to "control your computer from your phone"?

I want to turn this into an **open-source security checklist for remote-control tools** (and fold it into the project's `SECURITY.md` if it's useful), so every reply gets read and credited.

---

Project (MIT): https://github.com/2903077918-lgtm/DeepSeek-phone-harness
My security-ish implementation is open for review: `src/transport-lan.js` (auth / approval relay)
