# Evaluation Results

本目录负责 Run 产物、单任务报告、Run 总览、无效运行诊断、Baseline 比较和人工复核。实际产物保存在相邻的 `../runs/<runId>/`，由 Git 忽略。

有效 Run 的顶层 `report.md` 汇总 result、process、overall 三种结论，并链接到 `tasks/<taskRunId>/report.md`。单任务报告依次展示目标与输入、实际执行过程、最终业务结果、结果评估、过程评估、效率统计和完整性诊断；同目录 `observation.json` 保存完整结构化事实。基础设施无效的 Run 生成 `diagnostics.md`，不把部分评分冒充为质量结论。
