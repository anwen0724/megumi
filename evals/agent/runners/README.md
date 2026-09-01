# Evaluation Task Runners

Runner 负责一种顶层业务的真实调用方式：如何发起、如何等待完成、如何读取前后事实以及用什么标识关联 Trace。它不定义 Task 内容，也不评分。

已有 Runner：`conversation`、`interest_understanding`、`candidate_supply`、`daily_recommendation` 和 `preference_learning`。普通新任务应复用其中一个；只有增加新的顶层业务执行方式时才新增 Runner，并在 `task-runner.ts` 注册。
