# Megumi Agent Evaluation

该目录是 Megumi 唯一的 Agent 质量评估入口。它使用隔离的 Home、数据库与 Workspace，运行与 Desktop 相同的 `composeApplication` 和真实候选模型。

## 核心概念

一条 Evaluation Case 是一份“评测用例定义”，不是整份 JSON 原样发送给 Agent 的自然语言题目：

```text
Case       = 测试目标、触发动作、完成条件、证据要求和评分规则
Fixture    = 测试开始前的业务状态与受控外部输入
Trigger    = 对真实 Product Runtime 发起的业务操作
Evidence   = 真实执行留下的输入、前后事实、完成结果、Trace 和 Measurement
Grading    = 确定性硬门槛、Model Grader 维度和量化限制
Suite      = 按用途组合的一组独立 Case
Run Config = 本次运行选择的 Suite、模型、次数、并发、预算和输出目录
```

真正交给被测 Agent 的输入由 `Fixture + Trigger` 形成，并继续经过产品正常的 Context、Prompt 和 Tool 链路。会话 Case 的 `trigger.text` 是真实用户输入；其他业务 Case 通常通过业务操作和预置状态形成题目，不一定存在一段自然语言问题。

评分要求不会直接交给被测 Agent。Model Grader 在业务执行完成后接收 Case 的 `objective`、`modelGradedDimensions` 和本次 `EvidenceBundle`，据此评价语义质量。确定性 Grader 则直接检查完成事实、Trace、Evidence 和 Measurement。

完整流程：

```text
Run Config 选择 Suite
  → Suite 解析 Case
  → Fixture 安装到隔离环境
  → Trigger 调用真实业务能力和候选模型
  → Completion 等待业务终态
  → 收集 Evidence
  → 确定性 Grader + Model Grader
  → Case Result、Run Report 和可选 Baseline 对比
```

## 目录职责

- `cases/`：评测用例及其执行、证据和评分要求。
- `fixtures/`：每条 Case 使用的初始业务事实和 Controlled 外部输入。
- `suites/`：按运行目的组合 Case。
- `catalog/`：Case、Fixture、Suite 和 Run Config 的类型与加载校验。
- `capabilities/`：把不同顶层业务映射为可触发、可等待、可取证的评估执行器。
- `runtime/`：装配隔离产品、运行 Case、收集 Evidence 和调用 Grader。
- `reporting/`：生成报告、人工复核、Baseline 对比和运行保留清理。
- `baselines/`：已批准评估基准的存放约定。

## 常用命令

```text
npm run eval:agent -- catalog validate
npm run eval:agent -- run <run-config.json>
npm run eval:agent -- human review import <result.json> <review.json>
npm run eval:agent -- baseline approve <result.json> --id <baseline-id>
```

Controlled Profile 固定外部输入但不伪造模型输出；Live Profile 使用真实外部依赖。真实质量运行不属于普通 `npm test`，会产生模型费用。

Run Config 必须声明 `profile`、`suiteIds`、候选模型、Grader 模型、运行预算和 `runRoot`。`runRoot` 通常设置为本机 `.megumi/evaluation`；每个 Case 会在本次 Run 下创建独立 Home 和 Workspace。需要比较已批准 Baseline 时增加 `baseline.baselineId`，运行结果会同时写出 `baseline-comparison.json` 并在报告中展示差异。
