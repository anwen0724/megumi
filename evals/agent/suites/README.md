# Evaluation Suites

Suite 按运行目的引用若干独立 Task。它只包含 `suiteId`、版本、说明、Profile 和 `taskIds`，不修改 Task 的 Scenario、输入或 Metrics。

Run Config 可以同时使用 `taskIds` 和 `suiteIds`；重复 Task 会去重，再按 `repetitions` 分别执行。所有 Task 必须允许 Suite 指定的 Profile。
