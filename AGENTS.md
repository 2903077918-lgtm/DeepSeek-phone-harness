# Project Agent Instructions

## Project profile

- Name: deepseekharness-relay
- Type: fullstack
- Detected stack: Node.js (电脑端 Agent) + 单页 Web 控制台（手机端）+ 云端中转（远期）
- Purpose: 手机远程控制电脑上的 DSH（DeepSeek Harness）执行任务——类 Codex Relay 产品。手机浏览器/App 下发自然语言指令，电脑端 Agent 调用 DSH 执行并回传结果。MVP 先局域网直连验证链路，Agent 架构按云端可接入设计。

## Task boundary

- State objective, owned paths, excluded paths, acceptance criteria, tests, security constraints, and rollback notes before editing.
- Load only Skills required for the task.
- Production, secrets, migrations, deployment, external writes and destructive actions require explicit approval.

## Verification

- Run verified lint, typecheck, tests, and build; database changes require approval, migration and rollback notes.
- Match validation to L1/L2/L3 risk in `docs/ai-governance/WORKFLOW.md`.
- Review the final diff for scope drift, secret exposure and rollback gaps.

## Governance

- `docs/ai-governance/WORKFLOW.md` is the detailed workflow source for this project.
