# Megumi Agent Evaluation

这里是开发期的 Agent 评估平台。目前只实现三个阶段：建立 Dataset、定义 Metric、执行选定 Case 并保存原始结果。第四阶段的评估器与报告尚未实现。

Evaluation 不实现第二套业务流程。每个 Case 都由独立 Evaluation Host Root 调用正式的 `composeApplication`，再通过 `ProductRuntime.host` 进入真实业务 Owner。Agent Core 仍然拥有单次执行的生命周期；Evaluation 只负责准备隔离环境、发起业务动作、等待公开完成事实和保存证据。

## 当前能力

- Dataset：`datasets/controlled/` 与 `datasets/live/` 分别保存可重复的受控 Case 和使用真实外部依赖的 Case；Manifest 可按业务或测试目的组织 Case 子集。
- Metric Catalog：只定义指标的名称、适用业务、含义和量化口径，不在这里计算分数。
- Evaluation Run：一次选择一个或多个 Dataset/Case，逐个建立全新的隔离环境并顺序执行，保存 Trace、最终业务事实和 Workspace 变更产物。
- Evaluator / Report：暂未实现。现有代码不会判断 Case 好坏，不生成评分或报告。

## Dataset

每种业务先提供一个 Controlled Case：

- `controlled/conversation`
- `controlled/interest-understanding`
- `controlled/candidate-supply`
- `controlled/daily-recommendation`
- `controlled/preference-learning`

Case 的 `initialState` 是对应业务执行前必须存在的产品状态，`input` 是要通过真实 Product Host 发起的动作，`expected` 留给未来评估器使用。`expected` 会保存在 Case 快照中，但绝不会进入候选 Agent 的上下文。

校验或查看 Dataset：

```powershell
npm run eval:agent -- datasets validate
npm run eval:agent -- datasets show controlled/conversation
```

## Metric Catalog

查看已定义的通用指标和五类业务指标：

```powershell
npm run eval:agent -- metrics list
```

Metric Catalog 不包含规则、Prompt、阈值、评分器或汇总逻辑。后续新增评估器时再决定如何依据这些定义判断结果。

## 运行 Case

候选模型必须由一个显式 JSON 文件指定。凭据只从该文件指定的环境变量读取，不读取正常 Megumi Home 中的 Settings 或 CredentialStore。

```json
{
  "source": "explicit",
  "providerId": "openai",
  "modelId": "gpt-5.4",
  "api": "openai-responses",
  "baseUrl": "https://api.openai.com/v1",
  "contextWindowTokens": 128000,
  "maxOutputTokens": 8192,
  "credentialEnvironmentVariable": "MEGUMI_EVAL_API_KEY"
}
```

```powershell
$env:MEGUMI_EVAL_API_KEY = '<credential>'
npm run eval:agent -- run --candidate .\candidate-model.json --dataset controlled/conversation
```

`--dataset` 和 `--case` 均可重复传入。完整选择会在创建 Run 目录、执行任何 Case 之前完成校验。同一 Case 被多个 Dataset 或直接选择重复引用时只执行一次，同时保留全部 Dataset 归属。

## 隔离与结果

每个 Case 执行时会临时创建一套 Home、Workspace、业务 SQLite、Observability 存储和 Product Runtime。这是为了隔离不同 Case 以及正常产品数据；Case 结束后临时环境会被删除，下一 Case 不复用任何运行状态。

结果保存在 `evals/agent/records/<runId>/`：

```text
run.json
cases/<caseRunId>/
  case.json
  result.json
  traces/
    manifest.json
    journal/
    content/
  artifacts/
    workspace/
```

- `case.json` 固化本次实际运行的 Case、revision、digest、资源摘要和 Dataset 归属。
- `result.json` 保存 Product Owner 返回的最终业务结果、业务关联 ID、Trace 完整性和环境说明。
- `traces/` 保存该隔离 Case 的原生 Trace Journal、Content 与关联查询结果。
- `artifacts/workspace/` 只保存相对 Initial State 新增或修改的 Workspace 文件。

结果不会复制整个代码仓库、Home、Workspace 初始文件或 SQLite。Trace 是派生观测；最终业务状态以 Product Owner 返回值及其数据库事实为准。单个 Case 的基础设施失败会单独记录，后续 Case 继续执行。

## 目录职责

- `contracts/`：Dataset、Metric 和 Run 的稳定数据 Contract。
- `datasets/`：Controlled/Live Case、资源与 Dataset Manifest。
- `metrics/`：只读 Metric Catalog。
- `adapters/`：候选模型解析以及 Controlled/Live 外部环境差异。
- `run/`：Case 环境、Initial State 安装、真实业务驱动、Trace/产物归档和 Run 编排。
- `records/`：本地生成且不提交 Git 的不可变运行记录。
