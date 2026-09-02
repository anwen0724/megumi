# Evaluation Tasks

一个 Task 就是一项可直接执行的评测任务，不是测试框架内部写死的案例。开发者可以持续新增 JSON，并自由组合本任务需要查看的 Metrics。

## Task 字段

| 字段 | 用途 |
| --- | --- |
| `taskId` / `revision` | 稳定身份和版本 |
| `title` / `objective` | 说明评估目标；只供评估和报告使用 |
| `difficulty` / `tags` | 任务分级与检索 |
| `profiles` | 允许使用 `controlled` 或 `live` |
| `initialState` | 执行前安装到隔离产品环境的状态 |
| `input` | 交给真实产品入口的业务输入 |
| `metrics` | 本 Task 要评估的指标 |

`initialState` 可以包含 Workspace 文件、已有会话、Interest、Candidate、Recommendation、Preference、受控搜索结果、权限决定、时间和每日推荐数量。Task 内部使用 `referenceId` 建立引用，安装时才转换为真实数据库 ID。

`input.type` 支持：

- `conversation`：执行一个或多个用户任务步骤；
- `interest_understanding`：通过真实会话产生一次关注理解；
- `candidate_supply`：请求真实候选供给；
- `daily_recommendation`：请求真实每日推荐；
- `preference_learning`：对指定 Recommendation 写入反馈并等待偏好学习。

## Metrics

每个 Metric 必须声明 `dimension: result | process`：`result` 评估最终业务结果，`process` 评估 Context 使用、工具/来源选择、决策顺序、恢复和资源消耗。`evaluator` 再决定怎样评分：

- `rule`：用确定性规则检查完成事实或 Workspace 产物；
- `model`：把本 Metric 的 `rubric` 与任务 Observation 交给 Grader，返回 0–4 分；
- `measurement`：对耗时、Token、调用次数和业务产出数量执行阈值判断；
- `human`：保留给人工复核导入。

Task 的 `input` 是题目或业务动作；`metric.rubric` 是阅卷标准。候选 Agent 不会看到 `objective` 或 `rubric`。

Task 不定义超时。单任务防永久卡死的 15 分钟安全保护属于 Run Config，不参与产品状态或质量评分。

新增 Task 后执行 `npm run eval:agent -- tasks validate`。若要纳入固定批次，再把 `taskId` 添加到对应 Suite。
