# Evaluation Grading

评分器只消费 Task 声明的 Metrics 与执行后的 Observation。Rule 和 Measurement 提供确定性判断；Model Grader 按每项 Rubric 评分。Grader 故障属于评估基础设施故障，不会被写成候选 Agent 的质量失败。
