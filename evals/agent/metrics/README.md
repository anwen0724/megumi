# Evaluation Metrics

Metric 是报告中真正展示和判定的评估项。Task 作者在 JSON 中声明 Metric，运行时按 `evaluator` 分派：

- Rule Evaluator：确定性检查；
- Model Evaluator：真实 Grader 模型按独立 Rubric 评分；
- Measurement Evaluator：数值阈值比较。

Metric Evaluator 只消费已经收集的 Evidence，不调用或修改产品业务。新增一个具体质量指标通常只需在 Task 中增加 Model Metric；只有需要新的确定性算法或新的评分机制时才修改这里的 TypeScript。
