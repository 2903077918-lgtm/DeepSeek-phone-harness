# Inspired by codex-relay: we built a codex-relay-style remote UI for DeepSeek Harness 🐋

First off — thanks for [codex-relay](https://github.com/gronxb/codex-relay). It was the direct inspiration for a project we just open-sourced.

## What we built

**DeepSeek Phone Harness** — a mobile remote-control system for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), heavily inspired by codex-relay's architecture and design language (dark card-based UI, drawer navigation, approval cards):

- Chat with your desktop agent from your phone (4G/5G via Tailscale, no public IP)
- Real-time streaming output, tool-call cards (icon + status + file path + expandable args/result)
- Approval cards and `ask_user_question` answer cards inline in the message stream
- Model switching, image attachments, terminal, file browser, task history
- Zero npm dependencies — one Node process + one HTML file

## Why it's relevant here

codex-relay proved the "phone as a remote for a coding agent" pattern. We applied the same pattern to DeepSeek Harness, and hit some interesting differences worth sharing:

- **DSH's approval vs question channels are separate** — `ask_user_question` does NOT go through `approval/requested`; missing the question channel deadlocks tasks forever
- **Tool results are double-nested** in DSH's event format — easy to miss
- The relay approach (one `events.mux` WebSocket, incrementally polled) works great on 4G

## Repo

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

MIT licensed. Happy to chat about the architecture — and if you ever want a codex-relay-specific fork of this UI, I'd be glad to help.
