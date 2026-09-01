# Megumi Agent Evaluation

该目录是 Megumi 唯一的 Agent 质量评估入口。它使用隔离的 Home、数据库与 Workspace，运行与 Desktop 相同的 `composeApplication` 和真实候选模型。

常用命令：

```text
npm run eval:agent -- catalog validate
npm run eval:agent -- run <run-config.json>
npm run eval:agent -- human review import <result.json> <review.json>
npm run eval:agent -- baseline approve <result.json> --id <baseline-id>
```

Controlled Profile 固定外部输入但不伪造模型输出；Live Profile 使用真实外部依赖。真实质量运行不属于普通 `npm test`，会产生模型费用。

Run Config 必须声明 `profile`、`suiteIds`、候选模型、Grader 模型、运行预算和 `runRoot`。`runRoot` 通常设置为本机 `.megumi/evaluation`；每个 Case 会在本次 Run 下创建独立 Home 和 Workspace。需要比较已批准 Baseline 时增加 `baseline.baselineId`，运行结果会同时写出 `baseline-comparison.json` 并在报告中展示差异。
