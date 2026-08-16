# REVIEW-VERIFY 报告：verify-review-probe-1786857503106

**目标（Goal）**: `REVIEW-VERIFY verify-review-probe-1786857503106`  
**当前状态**: Goal 已完成（phase=`complete`），objective 在编辑后变为 `REVIEW-VERIFY-EDITED verify-review-probe-1786857503106`。  
**审查对象**: `src/executor.js` 中未提交的 Goal API 改动：
- `getSessionGoal` 将 `projections.values.goal` 拍平为 `goal.{id,revision,objective,phase,maxGoalRounds}`。
- `mutateGoal` 在前端未传 `ref` 时，自动从投影中推导当前 goal 的 `id`/`revision`。

---

## 1. 代码静态审查

### 1.1 `getSessionGoal` 拍平逻辑

文件：`src/executor.js:441-453`

```javascript
async getSessionGoal(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { ok: false, code: 'bad-request', error: 'sessionId 不能为空' };
  try {
    const value = await fetchRpc('session.list', {});
    const s = ((value && value.items) || []).find((x) => x.sessionId === sid);
    const proj = (s && s.projections && s.projections.values && s.projections.values.goal) || null;
    const goal = (proj && proj.goal) || null;
    return { ok: true, goal, meta: proj };
  } catch (e) {
    return { ok: false, code: 'backend-unavailable', error: '读取 goal 失败: ' + String(e) };
  }
}
```

验证结论：
- ✅ 空 `sessionId` 返回 `code: 'bad-request'`。
- ✅ 从 `projections.values.goal` 读取嵌套结构。
- ✅ 将内层 `proj.goal` 提升为返回值的顶层 `goal`，调用方可直接访问 `goal.id`、`goal.revision`、`goal.objective`、`goal.phase`、`goal.maxGoalRounds`。
- ✅ 原始投影保留在 `meta` 字段，便于调试。

### 1.2 `mutateGoal` 自动推导 ref

文件：`src/executor.js:456-499`

关键逻辑：

```javascript
const allowed = ['create', 'edit', 'pause', 'resume', 'complete', 'clear'];
if (!allowed.includes(act)) return { ok: false, code: 'bad-request', error: 'goal 动作只允许 ' + allowed.join('/') };

const goalOf = async () => {
  const out = await this.getSessionGoal(sid);
  return out.goal || null;
};

// edit / pause / resume / complete / clear：需要有效 ref
let useRef = (ref && ref.id && typeof ref.revision === 'number') ? ref : null;
if (!useRef) {
  const cur = await goalOf();
  if (cur && cur.id && typeof cur.revision === 'number') useRef = { id: cur.id, revision: cur.revision };
}
if (!useRef) return { ok: false, code: 'bad-request', error: '找不到目标，无法' + (act === 'clear' ? '清除' : '执行') };
```

验证结论：
- ✅ 仅允许 `create/edit/pause/resume/complete/clear` 六个动作，未知动作返回 `bad-request`。
- ✅ 显式传入有效 `ref` 时优先使用。
- ✅ 未传 `ref` 时，通过 `getSessionGoal` 从投影读取当前 goal 并构造 `{id, revision}`。
- ✅ 无目标时返回 `bad-request`，不会调用底层 RPC 导致空引用错误。
- ✅ `clear` 单独走 `goal.clear` RPC，其余动作统一走 `goal.{act}` RPC。
- ✅ `create` 单独校验 `objective` 非空，并可选写入 `maxGoalRounds`。

---

## 2. 测试覆盖审查

文件：`test-goal-api.mjs`

该测试使用本地 mock DSH RPC server，覆盖以下场景：

| # | 断言 | 对应 `verify-goal-review.mjs` 的验证点 |
|---|------|----------------------------------------|
| 1 | `getSessionGoal` / `mutateGoal` 已暴露 | 方法导出 |
| 2 | `getSessionGoal("") → bad-request` | 空 sessionId 护栏 |
| 3 | mock `session.create` 得到 sessionId | 会话创建 |
| 4 | `mutateGoal create` 成功并返回 ref | goal.create |
| 5 | `getSessionGoal` 拍平 goal 字段 + meta 携带原始投影 | 拍平与 meta |
| 6 | `pause` 不传 ref → 自动取投影 ref（revision+1） | pause 无 ref |
| 7 | `resume` 不传 ref → revision+1 | resume 无 ref |
| 8 | `edit` 不传 ref 改 objective/rounds → revision+1 | edit 无 ref |
| 9 | `complete` 不传 ref → revision+1 | complete 无 ref |
| 10 | complete 后投影 `phase === 'complete'` | phase 验证 |
| 11 | `clear` 不传 ref → 清空投影 | clear 无 ref |
| 12 | clear 后 `goal == null` | 清空确认 |
| 13 | 无目标时 `edit` → bad-request | 无目标护栏 |
| 14 | 非法 action → bad-request | 未知动作拒绝 |
| 15 | `create` 传 `maxGoalRounds=0` 被忽略仍成功 | 边界值处理 |

结论：测试用例与 `verify-goal-review.mjs` 的 11 个核心断言完全对齐，并额外覆盖边界值与非法动作。

---

## 3. 动态执行尝试与阻塞

### 3.1 尝试运行的命令

- `node verify-goal-review.mjs`（集成测试，连接真实 DSH Web API）
- `node test-goal-api.mjs`（mock 单测，无需真实 DSH）

### 3.2 阻塞原因

当前会话的 shell 执行被 DSH 运行时 ACL 策略拦截：

```
Error: Windows ACL temp root must be outside the workspace:
  workspace=C:\Users\Joey
  temp=C:\Users\Joey\AppData\Local\Temp
```

默认 Windows 临时目录位于当前工作区（`C:\Users\Joey`）内部，DSH 沙箱拒绝启动任何子进程。在沙箱外部重新配置 `TEMP`/`TMP` 之前，无法运行动态测试。

---

## 4. 综合结论

- ✅ `src/executor.js` 的 `getSessionGoal` 与 `mutateGoal` 实现符合设计目标。
- ✅ `test-goal-api.mjs` 提供了完整的 mock 级别回归测试。
- ⚠️ 集成测试 `verify-goal-review.mjs` 与 mock 单测均因环境 ACL（temp 目录位于 workspace 内）无法实际执行。
- 当前 goal（`goal-e3e3bf7c-0ceb-4633-8274-2bec2b89d307`）已处于 `complete` 阶段，objective 显示为 `REVIEW-VERIFY-EDITED verify-review-probe-1786857503106`，与 `verify-goal-review.mjs` 中 `edit` 步骤后的预期一致。

**审查结果：静态验证通过；动态验证被环境阻塞，待 `TEMP`/`TMP` 移出 workspace 后可重新运行 `node test-goal-api.mjs` 与 `node verify-goal-review.mjs`。**
