# Evaluation Run Configs

本目录保存可直接交给 Evaluation CLI 的开发期运行配置。配置只选择 Task/Suite、Candidate 与 Grader 模型、Profile、并发、预算、Baseline 和单任务安全保护；运行产物路径由 CLI 固定为 `evals/agent/runs/`。

运行全部 Controlled Tasks：

```powershell
npm run eval:agent -- run evals/agent/configs/run-all-controlled.json
```
