# Megumi Agent Evaluation

该目录是 Megumi 唯一的 Agent 质量评估入口。一次评估从可扩展的 `Evaluation Task` 开始，在隔离 Home、数据库与 Workspace 中运行真实 Product Runtime 和真实候选模型，再按 Task 声明的 Metrics 生成结果与报告。

## 如何增加一个评估任务

在 `tasks/<runner>/` 新增一个 JSON 即可。一个 Task 文件同时说明：

- `scenario`：开始前放入隔离环境的 Workspace 文件和业务事实；
- `steps` 或 `input`：真正交给被测产品执行的任务；
- `runner`：如何调用并等待这项业务；
- `metrics`：本任务要查看的规则、语义质量和量化指标。

新增普通 Task 不需要修改 TypeScript。只有引入全新的业务执行方式时才新增 Runner，引入新的评分机制时才新增 Metric Evaluator。完成后运行：

```text
npm run eval:agent -- tasks validate
```

会话任务不是简单问答，而是 Agent 需要完成的具体工作。当前示例分为：

- `simple`：读取材料并创建一份架构笔记；
- `medium`：综合多份材料并输出技术决策报告；
- `complex`：同一 Session 内先产出实施计划和风险清单，再根据复审材料修订。

具体字段和示例见 `tasks/README.md`。

## 执行与评估

```text
Run Config 选择 Task 或 Suite
  → 为每个 Task 建立隔离 Scenario
  → Runner 调用真实 Product Runtime
  → 收集业务事实、Trace、Runtime Event、Workspace 结果和 Measurements
  → 按 Task Metrics 分派 Rule、Model 或 Measurement Evaluator
  → 生成 Task Result、Run Report 和可选 Baseline 对比
```

Task 的 `steps` 或 `input` 是候选 Agent 真正执行的任务。`objective`、Metrics 和评分 Rubric 只供评估阶段使用，不注入候选 Agent 的产品提示词。Model Evaluator 在执行结束后接收本次完整开发 Evidence，并逐项评价 Task 声明的 Model Metrics。

## 目录职责

- `tasks/`：所有可独立运行的 Evaluation Task；这是新增评测任务的主要入口。
- `suites/`：按运行目的组合 Task，不改变 Task 内容。
- `contracts/`：Task、Metric、Suite、Run Config 和 Result 的运行时 Contract。
- `runtime/`：加载 Task、建立隔离环境、执行 Run、收集 Evidence、管理预算和产物。
- `runners/`：把不同顶层业务映射为可调用、可等待、可取证的执行方式。
- `metrics/`：Rule、Model 和 Measurement 三种 Metric Evaluator。
- `adapters/`：Controlled 与 Live Profile 的外部依赖适配。
- `reporting/`：报告、人工复核、Baseline 对比和本地保留清理。
- `baselines/`：已批准评估基准的存放约定。

## 常用命令

```text
npm run eval:agent -- tasks validate
npm run eval:agent -- run <run-config.json>
npm run eval:agent -- human review import <result.json> <review.json>
npm run eval:agent -- baseline approve <result.json> --id <baseline-id>
```

Run Config 可通过 `taskIds` 直接选 Task，也可通过 `suiteIds` 选择集合。`controlled` 固定外部来源、权限、时钟和 ID，但仍调用真实候选模型；`live` 使用真实外部依赖。两种 Profile 都会产生真实模型费用。`runRoot` 通常指向本机 `.megumi/evaluation`。
