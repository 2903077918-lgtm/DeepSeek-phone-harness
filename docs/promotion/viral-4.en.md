# Watching my agent work from the phone and the desktop at the same time — I can't go back

> You'd expect the phone to be a "downgraded" web page. After a side-by-side test, I found some experiences are actually better on mobile.

---

Before building DeepSeek Phone Harness, I set my own acceptance bar: **the phone must reach 80% of the desktop web experience, or it's not done.**

After finishing, I ran a controlled test: the same task, watched simultaneously on a desktop browser and a phone browser. The result surprised me — **a few experiences are genuinely better on mobile.**

## The test: one task, both screens

Task: let the agent read the project config, summarize current progress, and run a test.

| Dimension | Desktop web | Phone |
| --- | --- | --- |
| Streaming output | Fine | Fine (typewriter) |
| Tool-call visibility | Present | **Stronger**: each card shows the file path; tap for args + result |
| Approvals | Dialog/panel | **Cards inline in the message stream** — no page switch |
| Questions | Input takeover | **Option cards**, one tap |
| Model switching | Dropdown | Bottom sheet, thumb-reachable |
| Away from desk | Must be at the computer | **Works from anywhere** |

## Why mobile is better at some things

### 1. Approvals/questions don't break context

On desktop, an approval is a separate dialog that interrupts what you're reading. On mobile, I made approvals and questions **cards inserted directly into the message stream** — the context of *where* the agent is and *why* it's asking stays continuous.

### 2. Tool cards are naturally built for portrait

"Read file → run command → edit code" — a vertical sequence of tool calls is **made for a portrait screen**. On desktop you juggle logs and lists; on mobile it's one clean timeline:

```
[📄 read]   C:/.../config.json          ● done
[⚙️ pwsh]   npm test                    ● running…
```

### 3. Your thumb is the best mouse

Model switching, attachments, card expansion — everything lives within thumb reach.

## An honest comparison

Mobile is not a replacement for the desktop — **heavy work (editing lots of code, digging logs, multi-terminal) still belongs at a desk.** But mobile closes the desktop's biggest gap: **the moments you're not at the computer.**

- Send a task on the commute, read the result when you arrive
- Tweak a config before bed, find it verified in the morning
- Approve an agent request mid-meeting with one tap

**"Wherever you are, your agent is too"** — that's mobile's real value, not "a smaller webpage."

## The project

Open source (MIT):

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

Direct 4G/5G (free Tailscale), three-minute setup, zero npm dependencies.

**Which of your agent tasks could be done while you're away from the desk?** List them below — I'll see what belongs on the roadmap.
