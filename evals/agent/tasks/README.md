# Evaluation Tasks

每个 JSON 是一项完整、独立、可版本化的评估任务。场景、任务输入和评估指标不再拆成多份文件。

## Task 由什么组成

| 字段 | 含义 |
| --- | --- |
| `taskId`、`revision` | 稳定身份和语义版本；任务或评分要求变化时提升 revision |
| `title`、`objective` | 人工可读说明和评估目标；不会发给候选 Agent |
| `difficulty` | `simple`、`medium` 或 `complex` |
| `profiles` | 允许使用 `controlled`、`live` 或两者 |
| `runner` | 选择真实业务执行方式 |
| `scenario` | 隔离 Workspace 文件、会话、Interest、Candidate、Recommendation、Preference 和受控搜索结果 |
| `steps` / `input` | 候选 Agent 或业务 Runtime 真正收到的任务输入 |
| `completion` | Runner 等待的业务终态和超时 |
| `metrics` | 本任务最终展示和判定的评估指标 |

会话 Task 使用 `steps`。多步 Task 的所有步骤在同一 Session 中顺序执行，所以后续步骤可以复审和修改前一步产物。其他业务使用与 Runner 对应的 `input`。

## Metrics

- `rule`：检查完成事实、Trace、目标文件和固定安全边界；
- `model`：按该 Metric 自己的 `rubric` 对完整 Evidence 评分 0–4；
- `measurement`：比较耗时、Token、模型调用、工具调用、候选数或推荐数等数值。

`required: true` 的 Metric 失败会使 Task 失败；必要证据无法支持判断时为 `not_gradable`。非必需 Metric 仍出现在报告中，但不阻断 Task 通过。

## 新增任务步骤

1. 选择已有 Runner，并在对应目录新增 JSON。
2. 把初始材料和业务事实写入 `scenario`。
3. 写出候选 Agent 真正要执行的 `steps` 或业务 `input`。
4. 只声明本任务真正关心的 Metrics，并给每个 Model Metric 写清楚 Rubric。
5. 运行 `npm run eval:agent -- tasks validate`。
6. 需要批量运行时，再把 `taskId` 加入一个 Suite。

可直接参考 `conversation/create-architecture-note.json`、`conversation/compare-technical-options.json` 和 `conversation/plan-and-review-delivery.json`。
