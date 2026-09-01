# Evaluation Reporting

`reporting/` 负责消费评估结果，不参与被测业务执行：

- 将 Run Result 渲染为机器可读结果和 Markdown 报告；
- 导入人工复核结果；
- 批准 Baseline，并将新 Run 与同 Case、Revision、Fixture Version 的基准比较；
- 清理超过本地保留策略的旧 Run。

报告中的评分必须能够回到对应 Case、Grader、维度和 Evidence 引用。Baseline 是人工批准的比较基准，不是自动生成的正确答案，也不会替代单次 Case 的硬门槛与语义评分。
