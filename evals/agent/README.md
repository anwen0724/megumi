# Megumi Agent Evaluation

这里是开发期的 Agent 评估平台，支持建立 Dataset、定义 Metric、执行选定 Case、封存原始证据，以及离线评分、人工评审和逐 Case 基线比较。

Evaluation 不实现第二套业务流程。每个 Case 都由独立 Evaluation Host Root 调用正式的 `composeApplication`，再通过 `ProductRuntime.host` 进入真实业务 Owner。Agent Core 仍然拥有单次执行的生命周期；Evaluation 只负责准备隔离环境、发起业务动作、等待公开完成事实和保存证据。

## 当前能力

- Dataset：`datasets/controlled/` 与 `datasets/live/` 分别保存可重复的受控 Case 和使用真实外部依赖的 Case；Manifest 可按业务或测试目的组织 Case 子集。
- Metric Catalog：只定义指标的名称、适用业务、含义和量化口径，不在这里计算分数。
- Evaluation Run：一次选择一个或多个 Dataset/Case，逐个建立全新的隔离环境并顺序执行，保存 Trace、最终业务事实和 Workspace 变更产物。
- Evaluator / Report：独立读取封存 Run，自动计算 Trace 用量和确定性业务约束，生成 JSON/Markdown 报告及人工评审模板；不重新执行 Agent。
- Comparison：仅配对输入 digest、类型、环境和评分 Profile 相同的 Case，显示改善、退化及覆盖缺口。

## Dataset

每种业务先提供一个 Controlled Case：

- `controlled/conversation`
- `controlled/interest-understanding`
- `controlled/candidate-supply`
- `controlled/recommendation`
- `controlled/preference-learning`

另有 `controlled/recommendation-quality`、`controlled/preference-quality`，各含四条合成质量场景；当前合计 7 Dataset、13 Case。覆盖内容深度、负向偏好、历史去重、工作集扩展，以及单反馈、撤回、剩余支持和反馈反转。原五条基础 Case 保持不变；合成场景未经真实用户标注。

Case 的 `initialState` 是对应业务执行前必须存在的产品状态，`input` 是要通过真实 Product Host 发起的动作，`expected` 供评估器和评审者使用。`expected` 会保存在 Case 快照中，但绝不会进入候选 Agent 的上下文。

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

Metric Catalog 不包含规则、Prompt、阈值、评分器或汇总逻辑。`grading/profiles/` 独立选择指标、评分方式、方向、阈值与人工 rubric。

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

每个 Case 执行时会临时创建一套 Home、Workspace、业务 SQLite、Observability 存储和 Product Runtime。这是为了隔离不同 Case 以及正常产品数据。初始化直接安装已声明业务事实，不重放候选提交或偏好学习，不修改正式容量配置。下一 Case 不复用任何运行状态。

先停止业务、读取最终状态、关闭资源并封存证据，成功后才删除临时环境；收尾或留档不完整则保留现场，在 `cleanup.json` 记录路径。运行记录封存失败会抛出错误，临时环境不删除。

Controlled 当前仅支持 `open_web` 来源。真实产品自动后台触发关闭，只执行 Case 动作。Preference Case 可在 input 声明 `advanceTimeMs` 驱动真实学习定时器；当前示例推进 600000 毫秒，遵守少量反馈十分钟规则，不需要实际等待。未推进到触发时刻则保留 pending。

结果保存在 `evals/agent/records/<runId>/`：

```text
run.json
cases/<caseRunId>/
  case.json
  initial-state.json
  result.json
  cleanup.json
  traces/
    manifest.json
    journal/
    content/
    runtime/
  artifacts/
    initial-workspace/
    workspace/
```

- `case.json` 固化本次实际运行的 Case、revision、digest、资源摘要和 Dataset 归属。
- `initial-state.json` 保存实际安装后的业务事实、引用 ID 映射、起始时间、业务配置和初始文件摘要，不保存密钥。
- `result.json` 保存 Product Owner 返回结果、停止后的数据库事实、业务关联 ID、Trace 完整性、独立采集问题和文件清单。
- `traces/` 保存该隔离 Case 的原生 Trace Journal、Content、Runtime Log（存在时）与关联查询结果；查询分页收集，不截断为前 200 条。
- `artifacts/initial-workspace/` 保存初始 Case 文件；`artifacts/workspace/` 保存新增或修改文件，删除路径记录在 `result.json` 的 `artifacts.deletedFiles`。
- `cleanup.json` 单独说明临时环境已删除或保留，不改写已封存的业务结果。

结果不会复制整个代码仓库、Home 或 SQLite。Trace 记录过程证据，最终业务状态同时保留真实数据库事实；两者互补。单个 Case 的可记录基础设施失败会单独记录，后续 Case 继续执行。

`terminalState` 区分 settled（业务已返回终态，包括失败/取消）、pending（业务等待）和 interrupted（真实安全时限中断）。`recordStatus` 只说明证据留存是否成功，不是质量分数。达到 `--timeout-ms` 会请求停止并保存中断来源、限额、已取得结果及最终状态，不能把一次 Host 等待超时冒充业务失败。CLI 逐 Case 输出状态；基础设施失败或安全中断时退出码为 1。

## 目录职责

- `contracts/`：Dataset、Metric 和 Run 的稳定数据 Contract。
- `datasets/`：Controlled/Live Case、资源与 Dataset Manifest。
- `metrics/`：只读 Metric Catalog。
- `adapters/`：候选模型解析以及 Controlled/Live 外部环境差异。
- `run/`：Case 环境、Initial State 安装、真实业务驱动、Trace/产物归档和 Run 编排。
- `records/`：本地生成且不提交 Git 的不可变运行记录。
- `grading/`：评分 Contract、只读证据适配、确定性指标、人工评审绑定、比较与报告。

## 离线评分与比较

```powershell
npm run eval:agent -- score --run .\evals\agent\records\<runId> --profile .\evals\agent\grading\profiles\preference-quality.json --out .\evals\agent\records\score-before
npm run eval:agent -- compare --baseline .\evals\agent\records\score-before\score.json --candidate .\evals\agent\records\score-after\score.json --out .\evals\agent\records\comparison
```

输出父目录必须存在，输出目录必须是新目录且与输入目录互不包含。评分生成 `score.json`、`report.md`、`review-template.json`；比较生成 `comparison.json` 和 `report.md`。原始 Run 不变。

自动部分包含业务 Trace 耗时、模型/工具/来源调用、重试、输入输出 Token，以及新推荐身份去重、发布事实完整性、指定偏好撤回和剩余有效支持。输入 Token 沿用 Observability 的 `usage.inputTokens`，不含独立统计的缓存读写 Token，不能拿来代表整个提示词长度。Token 缺失、Trace 不完整或存在无法核验用量的重试时返回 `unavailable`，不以零代替。只统计对应 Case 业务 Trace，排除前置会话等其它业务；后台学习重试由多个 Trace/模型调用体现，不等同于模型内部的 retry 计数。

人工部分核对相关性、偏好范围与依据、推荐理由等语义。复制模板，在评审后把相应 `decision` 改为 `scored`，填写 `numerator`、`denominator`、`reason` 和 `reviewer`；不适用则使用 `not_applicable` 并说明原因。身份字段保持不变，再以 `score ... --review <review.json> --out <another-new-directory>` 生成新报告。修改 Case、证据或 rubric 后，旧标注不能直接套用；人工判断不能覆盖自动结果。

`passed` 只表示选中指标已完成且没有阈值失败；`failed` 表示业务失败或阈值失败；`incomplete` 表示待评审、未结束或证据不足。除 passed 外 score 均退出 1。首组 Profile 对硬约束设阈值 1；语义指标逐项呈现，不设置未经验证的总质量分数。

compare 将任何已配对指标的反向变化标为 `regressed`，包括用量或耗时上升；有缺口则不能宣称无退化。没有统计容忍区间，单次变化可能含模型和网络噪声。`no_observed_regression` 只覆盖本次相同样本/标准，不能证明真实用户长期体验。regressed/inconclusive 均退出 1，报告仍正常生成。
