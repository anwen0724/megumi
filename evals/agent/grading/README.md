# Evaluation Grading

评分器只消费 Task 声明的 Metrics 与执行后的 Observation。Metric 的 `dimension` 区分结果质量和过程质量，`evaluator` 区分 Rule、Model、Measurement 或 Human。Model Grader 分维度接收 Evidence：结果评分读取完整业务结果，过程评分读取执行过程和判断所需输入、Context 与输出。Grader 故障属于评估基础设施故障，不会被写成候选 Agent 的质量失败。
