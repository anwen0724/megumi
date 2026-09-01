# Evaluation Cases

`cases/` 保存评测用例定义。Case 描述“要在什么场景下触发哪个真实业务、等待什么结果、收集什么证据、如何判断质量”，不是把整份 JSON 当作提示词发送给 Agent。

## Case 如何成为一道测试题

```text
setup.fixtureId → 找到 Fixture，建立测试场景
capability      → 选择对应的业务评估执行器
trigger         → 向真实 Product Runtime 发起操作
completion      → 等待该业务的持久化终态
requiredEvidence→ 检查答卷是否完整
grading         → 对答卷执行确定性与模型评分
```

会话 Case 的 `trigger.text` 会作为用户输入进入被测 Agent。关注理解、候选供给、每日推荐和偏好学习 Case 的题目主要由 Fixture 中的状态、Trigger 业务操作和 Controlled 外部返回共同构成。

## 字段职责

| 字段 | 职责 | 是否直接进入 Model Grader |
| --- | --- | --- |
| `caseId` | Case 稳定标识 | 否 |
| `revision` | Case 定义版本 | 否 |
| `fixtureVersion` | 要求匹配的 Fixture 版本 | 否 |
| `title` | 人工阅读名称 | 否 |
| `objective` | 本 Case 要验证的质量目标 | 是 |
| `profiles` | 允许运行的 `controlled` / `live` Profile | 否 |
| `tags` | 检索和分类标签 | 否 |
| `capability` | 选择顶层业务评估执行器 | 否 |
| `setup.fixtureId` | 选择场景数据 | 否 |
| `trigger` | 触发真实业务操作 | 否；但其中的真实业务输入会进入产品链路 |
| `completion` | 完成事实类型和等待超时 | 否 |
| `requiredEvidence` | 必须存在的 Evidence 部分 | 否 |
| `grading.hardGates` | 由代码直接判断的硬门槛 | 否 |
| `grading.dimensions` | 本 Case 声明使用的完整评估维度 | 否 |
| `grading.requiredDimensions` | 必须达到通过线的模型评分维度 | 间接参与最终判定 |
| `grading.modelGradedDimensions` | 要求 Model Grader 评价的维度 | 是 |
| `grading.measurementLimits` | Token、耗时、调用次数等量化限制 | 否 |

Model Grader 当前接收 `objective + modelGradedDimensions + EvidenceBundle`，输出每个维度的判断、`0–4` 分、理由和 Evidence 引用。`3` 分表示达到要求；必需维度低于 `3` 分时 Case 失败。

Case 必须与同能力目录下、同 `fixtureId` 和 `fixtureVersion` 的 Fixture 对应。修改测试场景语义时应同步提升相应版本，避免新旧结果被错误比较。
