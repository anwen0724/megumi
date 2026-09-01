# Evaluation Contracts

`contracts/` 只定义 Evaluation 的稳定运行时数据边界：

- `evaluation-task.ts`：一个可执行 Task 及其 Scenario、输入和 Runner；
- `evaluation-metric.ts`：Task 可声明的 Rule、Model 和 Measurement Metric；
- `evaluation-suite.ts`：Task 集合；
- `evaluation-run-config.ts`：一次 Run 的任务选择、模型来源、并发、预算和输出位置；模型来源可为当前选择、Settings 中指定模型或自定义模型定义，不接受明文凭据；
- `evaluation-result.ts`：逐 Task、逐 Metric 的机器结果。

JSON 加载必须经过这些 Zod Schema。新增普通 Task 不应修改 Contract；只有作者表达能力确实不足时才扩展。
