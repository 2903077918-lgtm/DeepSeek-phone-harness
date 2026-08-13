# Codex 工作流程

## 1. 风险分级

### L1 轻量任务

适用于问答、解释、只读检查和小型文档整理。

流程：理解需求 → 完成任务 → 简洁报告。

### L2 标准任务

适用于普通代码、配置和脚本修改。

流程：确认范围与验收标准 → 修改 → 运行相关验证 → 报告结果。

### L3 高风险任务

适用于生产、部署、迁移、密钥、权限、删除、核心 Agent 逻辑和大规模重构。

流程：明确授权 → 建立基线 → 最小修改 → 完整验证 → 人工审查 → 提供回滚方式。

风险级别只能增加必要控制，不能降低平台、全局规则或用户指令规定的安全要求。

## 2. 任务范围

- 开始前明确目标、负责路径、禁止路径、现有行为、期望行为、验收标准和安全约束。
- L2/L3任务应提供可执行的验证命令；不存在的命令不得编造。
- 只读取和修改任务所需内容；需要越界时先说明原因并取得授权。
- 任务说明模板按需使用，不强制用于L1任务。

## 3. 验证标准

- 文档和规则修改：检查结构、链接、关键约束和前后差异。
- 代码修改：运行项目已有的相关测试，并按需运行 lint、类型检查或构建。
- 配置修改：运行语法校验和安全可行的启动自检。
- L3任务：建立修改前基线，执行完整验证，并证明回滚路径可用。
- 不添加恒定通过的假测试；验证失败不得被描述为完成。

## 4. 成本与复盘

仅在以下情况生成任务成本报告或执行流程改进复盘：

- L3或大型任务。
- 任务失败、多次返工或出现事故。
- 周期性治理复盘。
- 用户明确要求。

可见指标如实记录；不可见的Token、人工时间或成本标记为 `Not observed`，不得估造。只有重复出现、适用于多个任务且有数据证明价值的问题，才进入建议流程。

## 5. 权限与安全

- 默认最小权限；写入范围由任务授权决定。
- 未经明确授权，不执行生产修改、迁移、部署、删除或外部通信。
- 不读取、复制或输出 `.env`、凭据、私钥和密钥值。
- 高风险修改必须保留备份或其他可操作回滚方式。

## 6. 多 Agent 边界

- 默认不启用多 Agent。
- 仅当任务能够独立分解且规则或用户明确允许时启用。
- 每个 Agent 必须拥有明确且不重叠的文件或目录责任。
- Agent 不得撤销其他人的修改；合并前必须检查冲突和整体测试结果。

## 7. Codex Improvement Governance

- 唯一事实源为 `.codex/improvements/REGISTRY.md`；所有技巧发现、自我改进、规则演进、流程和成本优化共用一个 Proposal 生命周期。
- Agent 可自动读取、比较、去重、分类、提出建议和测试方案；执行 Proposal、修改长期治理或 supersede 规则必须收到 `APPROVE <ID>`。
- Apply 前确认真实 Git checkpoint；Git 不可用时使用日期备份并如实记录。验证失败立即停止并记录失败与回滚状态。
- 禁止 Agent 自行批准、绕过审批、扩大权限或删除失败与审计历史。
- Low-risk task-level improvements may use `AUTO_ADOPT` only under the human-pre-authorized Policy in the Registry. Agent cannot authorize itself or modify that Policy automatically.
- Governance, permission, persistent configuration and Auto Approval Policy changes always remain `PROPOSE → APPROVE <ID> → Apply`.

### 7.1 Improvement Outcome Evaluation — Phase 1

- 已采用 Improvement 的评估流程为 `APPLIED → OBSERVATION → Measure → IMPROVEMENT IMPACT REPORT → EVALUATED → 人工决定`。
- 默认观察最近 20 个相关任务；采用后不足 20 个任务时必须输出 `INSUFFICIENT_DATA`，不得提前推断。
- Before 与 After 只比较任务耗时、失败尝试、重试、回滚、人工介入、成功/失败结果，以及已有的 Token 和估算成本数据；未知值写 `Not observed`。
- 统一结果为 `IMPROVED`、`NEUTRAL`、`REGRESSED` 或 `INSUFFICIENT_DATA`；建议为 `KEEP`、`REVIEW` 或 `ROLLBACK_CONSIDERATION`。
- Evaluation Report 是分析记录，不是执行授权。禁止据此自动删除规则、回滚长期规则、修改治理机制、改变 Auto Approval Policy 或绕过人工审批。
- Phase 1 不实现 Experience Memory、Data-driven Self Discovery、自动发现规则、自动生成优化 Proposal 或自动修改工作流。

## 8. 交付

完成时报告：

- 实际修改内容和文件。
- 执行的验证及结果。
- 未验证或未完成事项。
- 已知风险和必要回滚方式。

高风险改动在人工审查完成前不得部署。

