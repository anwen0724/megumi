# Megumi Agent Evaluation

这里是开发期的 Agent 质量评估模块。它不会实现第二套业务流程：每个 Task 都会建立隔离的 Megumi 环境，然后通过 `ProductRuntime.host` 的公开入口执行与正常产品相同的会话、关注理解、候选供给、每日推荐或偏好学习流程。

一次评估的流程是：

```text
Task JSON
  → 安装 initialState
  → input 调用真实 ProductRuntime
  → 等待真实业务终态
  → 收集结果、Workspace 产物和 Trace 引用
  → 按 Task 声明的 Metrics 评分
  → 有效运行生成 report.md；基础设施失败生成 diagnostics.md
```

候选 Agent 只接收 `input` 通过产品正常链路构造出的输入和 `initialState` 安装出的产品状态。`objective`、`metrics` 与 Model Grader 的 `rubric` 只用于执行后的评估，不会注入候选 Agent 的上下文。

## 如何新增评估任务

在 `tasks/<业务>/` 新增一个 JSON，无需修改 TypeScript。Task 至少声明：

- `initialState`：执行前需要安装的产品状态；
- `input`：要交给真实产品入口的任务输入；
- `timeoutMs`：等待真实业务完成的上限；
- `metrics`：本任务需要查看的评估指标。

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

`controlled` 使用确定性的来源、权限和时间 Adapter，但模型调用仍通过 `@megumi/ai` 的真实接口；`live` 使用真实来源。两者执行的业务代码相同。

## 目录职责

- `contracts/`：Task、Metric、Suite、Run Config 与结果 Contract。
- `tasks/`：可独立扩展的评估任务。
- `suites/`：按运行目的组合 Task。
- `adapters/`：Controlled/Live 环境差异以及评估模型解析。
- `execution/`：隔离环境、初始状态安装、真实产品调用、观察与 Run 编排。
- `grading/`：Rule、Model、Measurement 三类评分器。
- `results/`：结果持久化、报告、诊断、Baseline 与人工复核。

完整 Trace 仍保存在该隔离任务的 Observability Journal 中。Evaluation Observation 只保存 Trace ID、紧凑摘要、业务结果、Workspace 产物和 Measurement，避免复制一套 Trace 数据。
