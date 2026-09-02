# Megumi Agent Evaluation

这里是开发期的 Agent 质量评估模块。它不会实现第二套业务流程：每个 Task 都会建立隔离的 Megumi 环境，然后通过 `ProductRuntime.host` 的公开入口执行与正常产品相同的会话、关注理解、候选供给、每日推荐或偏好学习流程。

一次评估的流程是：

```text
Task JSON
  → 安装 initialState
  → input 调用真实 ProductRuntime
  → 等待公开业务完成事实
  → 用 typed Trace Target 等待并读取原生 Trace
  → 投影可读执行过程并构造 Evidence 与 Measurement
  → 分别评估结果质量和过程质量
  → 有效运行生成 report.md；基础设施失败生成 diagnostics.md
```

候选 Agent 只接收 `input` 通过产品正常链路构造出的输入和 `initialState` 安装出的产品状态。`objective`、`metrics` 与 Model Grader 的 `rubric` 只用于执行后的评估，不会注入候选 Agent 的上下文。

## 如何新增评估任务

在 `tasks/<业务>/` 新增一个 JSON，无需修改 TypeScript。Task 至少声明：

- `initialState`：执行前需要安装的产品状态；
- `input`：要交给真实产品入口的任务输入；
- `metrics`：本任务需要查看的评估指标，每项必须声明 `result` 或 `process` 维度。

`input.type` 决定调用哪个现有产品入口。只有产品新增了新的顶层业务入口，才需要扩展 `execution/execute-task.ts`；新增普通任务或新增同类任务，不需要增加 Runner。

任务字段和示例见 [tasks/README.md](tasks/README.md)。完成后运行：

```powershell
npm run eval:agent -- tasks validate
```

## 运行

候选模型和 Grader 模型都支持读取当前 Megumi 配置，或在 Run Config 中单独指定。运行命令：

```powershell
npm run eval:agent -- run <config.json>
```

运行产物固定保存在 `evals/agent/runs/<runId>/`，属于本地开发评估数据并由 Git 忽略。Run Config 不负责选择输出目录，评估数据不会写入产品 `.megumi`。

Run Config 的 `safetyWallClockLimitMs` 默认是 900000（15 分钟），只防止单个隔离执行永久卡死。它不属于 Task、产品业务状态或质量指标；触发后会记录 `evaluation_safety_guard` interruption 和已有事实。

`controlled` 使用确定性的来源、权限和时间 Adapter，但模型调用仍通过 `@megumi/ai` 的真实接口；启动 Runtime 时使用 `manual` 后台触发策略，避免目标任务被启动补池、每日补偿和偏好积压排空抢占。`live` 使用真实来源和产品默认的 `automatic` 后台触发。两者执行的业务代码相同。

## Trace Target、Evidence 与 Measurement

Evaluation 不按 `input.type` 猜 Trace，也不扫描任意 JSON 猜测结果。真实业务完成后，执行层返回带 `traceKind`、`correlation` 和 `expectation` 的 Trace Target：

- Conversation 用 `executionId` 定位每轮会话 Trace；
- Interest Understanding 同时保留源 Conversation Trace，只有产生 `interestUnderstandingId` 后才要求理解 Trace；
- Candidate Supply 只有真正开始执行时，才用 `candidateSupplyId + executionId` 定位 Trace；`no_gap`、`cooldown` 等未执行结果不查询空 Trace；
- Daily Recommendation 只用稳定的 `dailyRecommendationBatchId` 定位本轮批次，再按每条 Trace 自带的 `executionId` 区分全部 Attempt；
- Preference Learning 用 `preferenceLearningBatchId` 定位学习批次，`feedbackChangeId` 只用于等待业务完成。

业务结束后，Evaluation 最多等待 2 秒完成 `flush → list → get`。查询失败、应有 Trace 丢失和 Trace 诊断不完整分别记录为 `trace_query_failed`、`correlated_trace_missing` 和 `trace_incomplete`，条件未触发不会误报。

Grader 接收的 Evidence 固定分为 `input`、`context`、`execution`、`output` 和 `measurement`。Trace、Content 和 Measurement 都只通过 Product Host 读取；Daily Recommendation 的历史推荐放在 Context，本轮批次和 `recommendation.published` 放在 Output；Preference Learning 保存本批 Feedback、学习前 Preference 和带完整 Supporting Feedback 的学习后 Preference。

每个 Metric 的 `dimension` 决定它评估最终结果还是执行过程，`evaluator` 决定使用 Rule、Model、Measurement 或 Human 中哪种评分方式。结果、过程和总体结论分别保存，不与产品 Owner 返回的业务状态混为一谈。

调用次数、Token 和费用由 `@megumi/observability` 从原生 Trace 与 `model.response` Content 派生，不写第二份 Measurement 日志。业务产出数量来自对应的 typed 完成结果。指标无法可靠取得时，Measurement Grader 返回 `not_gradable`，不会把缺失值当作零。

## 目录职责

- `contracts/`：Task、Metric、Suite、Run Config 与结果 Contract。
- `configs/`：可直接运行的开发期评估配置。
- `tasks/`：可独立扩展的评估任务。
- `suites/`：按运行目的组合 Task。
- `adapters/`：Controlled/Live 环境差异以及评估模型解析。
- `execution/`：隔离环境、初始状态安装、真实产品调用、观察与 Run 编排。
- `grading/`：Rule、Model、Measurement 三类评分器。
- `results/`：结果持久化、报告、诊断、Baseline 与人工复核。
- `runs/`：本地生成的 Run、单任务 Observation、单任务报告、隔离产品数据和总览，不提交 Git。

完整 Trace 仍保存在该隔离任务的 Observability Journal 中。Evaluation Observation 保存 Trace ID、按 Attempt/Trace 组织的执行过程投影、当前任务需要的 Content Evidence、业务结果、Workspace 产物和 Measurement，不复制完整 Journal 或 Runtime Event 流。先看顶层 `report.md`，再打开 `tasks/<taskRunId>/report.md` 理解单个任务；需要核对完整结构化事实时再查看同目录 `observation.json`。
