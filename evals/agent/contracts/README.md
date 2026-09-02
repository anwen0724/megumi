# Evaluation Contracts

- `evaluation-task.ts`：Task 的初始状态、真实产品输入和 Metrics。
- `evaluation-metric.ts`：结果/过程维度以及 Rule、Model、Measurement Metric。
- `evaluation-suite.ts`：Task 组合。
- `evaluation-run-config.ts`：Profile、模型、预算、并发和 Baseline 配置。
- `evaluation-result.ts`：产品执行事实、结果/过程/总体判断和基础设施有效性。

Contract 只描述评估模块自己的稳定数据，不复制产品业务 Contract。真实业务输入由 `execution/execute-task.ts` 映射到 `ProductRuntime.host` 的公开入口。
