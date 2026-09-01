# Evaluation Runtime

`runtime/` 负责把 Case 真正运行起来：

```text
装配隔离 Product Runtime
  → 安装 Fixture
  → 调用 Capability Evaluation
  → 收集 EvidenceBundle
  → 执行 Hard Gates
  → 调用 Model Grader
  → 汇总 Case Result 和 Run Result
  → 释放该 Case 的资源
```

候选模型与 Grader 模型职责不同：

- 候选模型属于被测产品，看到产品正常构建的 Context、Prompt 和 Tools；
- Grader 模型属于评估系统，只在执行结束后看到 `objective`、待评维度和 `EvidenceBundle`；
- Case 的评分规则不会注入候选模型的产品提示词。

`controlled` Profile 注入固定的来源、Web、权限、时钟和 ID Adapter，但仍运行真实 Product Runtime 和真实候选模型。`live` Profile 使用真实外部依赖。每条 Case 使用独立 Home、数据库和 Workspace，失败不得污染其他 Case。

Evidence 不等同于日志全文。它是本次 Case 的结构化答卷，包括业务输入、前后事实、完成事实、Trace、Runtime Event、Measurement 以及缺失证据问题。Model Grader 当前接收完整 EvidenceBundle，并被要求只依据其中证据评分。
