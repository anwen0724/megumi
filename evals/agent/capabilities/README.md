# Capability Evaluations

`capabilities/` 是 Evaluation Runner 与真实顶层业务之间的薄适配层。每个能力执行器只负责：

1. 读取对应 Case 的 Trigger；
2. 调用真实 Product Runtime 或业务 Owner；
3. 按 Completion Contract 等待终态；
4. 返回该能力的输入、执行前事实、完成事实、执行后事实和关联 ID，供统一 Evidence Collector 取证。

当前能力包括：

- `conversation`：发送真实用户输入并等待会话 Run 终态；
- `interest-understanding`：提交已完成会话轮次并等待关注理解终态；
- `candidate-supply`：请求候选供给并等待 Supply Check 终态；
- `daily-recommendation`：确保指定日期的每日推荐并等待 Batch 终态；
- `preference-learning`：更新推荐反馈并等待偏好学习结算。

这里不复制搜索、入池、推荐或偏好学习规则；被评估的仍是产品真实实现。
