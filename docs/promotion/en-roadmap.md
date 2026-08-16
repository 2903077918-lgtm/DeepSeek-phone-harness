# Where DeepSeek Phone Harness goes next — and how you can shape it

> A roadmap, an honest status check, and a call for contributors. The most-requested feature ships first.

---

Two weeks ago this was a sketch. Today [DeepSeek Phone Harness](https://github.com/2903077918-lgtm/DeepSeek-phone-harness) runs on my phone every day. Here's where it's headed — and where you come in.

## Status check (honest)

**Working well:**
- Chat + streaming typewriter, multi-turn sessions
- Tool cards: icon, status, file path, expandable args/result
- Approval cards + `ask_user_question` answer cards (no more deadlocks)
- Model switching, image attachments, thinking disclosure
- Terminal, file browser, task history, session management
- Zero npm dependencies; runs on any Node 22+

**Known limits (being honest):**
- Web page, not a native app (PWA covers most of it)
- Terminal runs commands one at a time — no full PTY interactivity yet
- No push notifications yet — you poll, it doesn't call you
- Cloud channel requires deploying your own Worker

## Roadmap — most-requested first

1. **Push notifications** — task finished, approval needed → phone notifies without opening the page
2. **PWA offline shell** — add to home screen, feels native
3. **Persistent PTY terminal** — interactive commands, not just run-and-collect
4. **Multi-device / multi-account** — one agent, several controllers
5. **Native shell (Tauri/Electron)** — if the demand shows up

## How you can shape it

- **Open an issue** with your most-wanted feature — the roadmap above is literally "what people asked for"
- **PR welcome**: the codebase is ~4000 lines of plain Node + one HTML file. No build step, no framework to learn. A focused PR is a weekend at most
- **Report the ugly**: a weird hang, a wrong tool card, a confusing flow — file it, I read everything

## The rule

The roadmap is ordered by request count, not by my preference. **If your feature isn't on the list, that's because nobody asked for it yet.** So ask.

Repo:

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

*What's the one feature that would make you use this daily? One line is enough.*
