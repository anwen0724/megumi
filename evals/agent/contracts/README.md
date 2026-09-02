# Evaluation Contracts

- `evaluation-dataset.ts`：Dataset Manifest 与五类业务 Case 的固定 authoring Contract。
- `metric-definition.ts`：指标名称、作用范围、定义和量化口径。
- `evaluation-run.ts`：显式候选模型配置、Run 请求、Case 快照和不可变执行记录。

这些 Contract 只描述 Evaluation 自己的数据，不复制产品业务 Contract，也不包含评估器、评分或报告定义。真实业务调用统一由 `run/` 映射到 `ProductRuntime.host` 的公开入口。
