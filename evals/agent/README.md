# Megumi Agent Evaluation 使用说明

本目录用于使用真实 Product Runtime 和真实模型验证 Agent 的任务完成能力。Evaluation 是开发验证基础设施，不参与 Megumi 的生产运行，也不会把评估结论写入业务数据库。

Evaluation 会真实调用所选 LLM Provider，可能产生 API 费用。运行前应确认 Target、Case 和重复次数。

## 1. 先理解四个配置

一次 Evaluation 由四类配置共同决定：

```text
Suite   要运行的一组 Case，以及整组通过标准
Case    用户请求、Fixture、环境要求和 Grader
Target  Provider 与 Model
Profile 工具、权限模式、网络和隔离级别
```

代码 Runner 只固定要运行的 Suite，不绑定 Provider：

```text
run-recovery.mjs → recovery Suite
run-coding.mjs   → coding Suite
```

实际 Target 由项目根目录 `.env` 明确选择；Profile 从 Suite 配置自动解析，避免代码入口和 Suite 配置不一致。

## 2. 配置根目录 `.env`

代码 Runner 会读取：

```text
<项目根目录>/.env
```

除了 Provider Key，还必须明确当前 Evaluation 使用哪个 Target、从哪个环境变量读取该 Target 的 Key。

### 使用 OpenAI Target

```dotenv
MEGUMI_EVALUATION_TARGET=openai-gpt-5-6
MEGUMI_EVALUATION_CREDENTIAL_ENV=OPENAI_API_KEY
OPENAI_API_KEY=你的密钥
```

### 使用 DeepSeek Target

```dotenv
MEGUMI_EVALUATION_TARGET=deepseek-v4-flash
MEGUMI_EVALUATION_CREDENTIAL_ENV=DEEPSEEK_API_KEY
DEEPSEEK_API_KEY=你的密钥
```

这里只是示例，不存在默认绑定的 Provider。`MEGUMI_EVALUATION_TARGET` 必须对应：

```text
evals/agent/config/targets/*.json
```

`MEGUMI_EVALUATION_CREDENTIAL_ENV` 的值是环境变量名称，不是 API Key 本身。

加载规则：

- WebStorm Run Configuration 已提供同名环境变量时，以 WebStorm 环境变量为准；
- 否则读取根目录 `.env`；
- 不会在控制台打印 API Key；
- 缺少 Target、Credential 环境变量名或实际 Key 时，会在调用 Provider 前直接失败；
- `.env` 已在 `.gitignore` 中忽略，不会进入 Git 提交。

## 3. 推荐方式：WebStorm 右键运行代码

这是日常开发推荐方式，不需要打开终端，也不需要填写 CLI 参数。

### 3.1 Recovery 测试

在 WebStorm Project 面板找到：

```text
evals/agent/runs/run-recovery.mjs
```

右键选择：

```text
Run 'run-recovery.mjs'
```

执行链路：

```text
读取根目录 .env
→ 解析 MEGUMI_EVALUATION_TARGET
→ 解析 MEGUMI_EVALUATION_CREDENTIAL_ENV
→ 加载 recovery Suite
→ 从 Suite 自动解析 Profile
→ 直接调用 runEvaluationSuite()
→ 运行真实 Agent
→ 写入报告
```

当前 Recovery Suite 包含：

- `recovery-approval-deny`：写文件审批被拒绝后，Agent 不得声称文件已经创建；
- `recovery-tool-failure`：第一次读取失败后，Agent 应使用用户允许的 fallback，并在最终回复中包含实际标记。

### 3.2 Coding 文件交付测试

右键运行：

```text
evals/agent/runs/run-coding.mjs
```

它会运行 Coding Suite，当前验证：

```text
读取 fixture
→ 创建 answer.md
→ 再次读取并验证 answer.md
→ 根据真实结果提交最终回复
```

### 3.3 这些文件是不是又调用了 CLI

不是。

`.mjs` 入口只用于让 WebStorm 和 Node 可以直接右键运行。它通过 `tsx` 的程序化 API 加载 TypeScript，然后调用：

```ts
runEnvironmentConfiguredEvaluation(...)
  → runEvaluationSuite(...)
```

它不经过 `evals/agent/cli.ts`，也不解析命令行参数。

### 3.4 WebStorm 没有显示 Run

`.mjs` 是标准 Node.js 代码入口。WebStorm 正常情况下会直接显示 Run。

如果没有：

1. 打开 `Settings | Plugins`；
2. 确认 JavaScript and TypeScript、Node.js 支持已启用；
3. 打开 `Settings | Languages & Frameworks | Node.js`；
4. 确认选择了可用的 Node.js Interpreter；
5. 重新右键 `.mjs` 文件。

## 4. 运行结果怎么看

成功时，WebStorm Run 窗口会显示：

```text
Suite verdict: passed
Case recovery-approval-deny #1: passed
Case recovery-tool-failure #1: passed
Report: C:\...\megumi\evals\reports\2026-...-recovery-<target>
```

Suite 未通过时，Runner 会在报告已经写入后抛出错误：

```text
Suite recovery finished with verdict failed.
Review C:\...\evals\reports\...
```

不要只看最后一行错误，应打开报告确认具体是哪个 Case、Grader 或运行阶段失败。

## 5. 报告目录

默认目录：

```text
evals/reports/<时间>-<suite>-<target>/
```

内容：

```text
summary.md
summary.json
executions/
  <case-id>-<repetition>.json
```

### `summary.md`

适合人工阅读，包含：

- Suite、Target、Profile；
- 总体 Verdict 和 Pass Rate；
- 每个 Case 的执行状态与 Verdict；
- 最终回复摘要；
- 文件变化；
- 每个 Grader 的结果；
- Diagnostic 和 Baseline 差异。

### `summary.json`

完整结构化 Suite Report，适合程序处理和后续对比。

### `executions/*.json`

每个 Case 每次执行一份详细报告，可用于排查：

- Agent Run 是否正常终止；
- Model Call 和 Tool Call 次数；
- Runtime Events；
- 最终回复；
- Workspace 文件证据；
- 每个 Grader 为什么通过或失败。

`evals/reports/` 已被 Git 忽略。报告经过敏感字段脱敏，但仍可能包含任务文本和受控 Fixture 内容，不应随意公开。

## 6. Verdict 与 Grader 状态

### Suite Verdict

- `passed`：满足 Suite Policy；
- `failed`：一个或多个必需 Case 未通过；
- `invalid`：没有足够的有效执行支撑结论。

### Case Verdict

- `passed`：所有必需 Grader 通过；
- `failed`：至少一个必需 Grader 失败；
- `needs_review`：需要人工判断；
- `insufficient_evidence`：运行或证据不足，不能得出结论。

### Grader Status

- `passed`：满足规则；
- `failed`：不满足规则；
- `needs_review`：需要人工判断；
- `error`：证据缺失或 Grader 无法运行；
- `skipped`：当前条件下无需执行。

## 7. 直接在其它代码中运行

如果需要自定义固定组合，可以直接调用 TypeScript API：

```ts
import { runConfiguredEvaluation } from './runs/run-configured-evaluation';

const result = await runConfiguredEvaluation({
  repositoryRoot: 'C:/all/work/study/megumi',
  suiteId: 'recovery',
  targetId: 'openai-gpt-5-6',
  profileId: 'controlled-write-approval',
  credentialEnvironmentVariable: 'OPENAI_API_KEY',
});

console.log(result.report.verdict);
console.log(result.reportDirectory);
```

这个低层 API 显式接收 Target/Profile，适合自动化代码生成固定、可复现的测试组合。

日常右键入口使用的是更高层 API：

```ts
runEnvironmentConfiguredEvaluation({
  repositoryRoot,
  suiteId: 'recovery',
});
```

它从 `.env` 选择 Target，并从 Suite 自动解析 Profile。

两种方式都直接复用现有 Catalog、Product Runtime、Evidence、Grader 和 Report Writer，不建立第二套测试逻辑。

## 8. CLI 方式：用于批量执行或 CI

日常使用 WebStorm 时不需要 CLI。CLI 主要用于：

- CI；
- 批量切换 Suite / Target / Profile；
- 按 Tag 或 Case 过滤；
- 覆盖 repetitions；
- 接受人工 Baseline。

列出配置：

```powershell
npm run eval:agent -- list
```

示例：

```powershell
npm run eval:agent -- run `
  --suite recovery `
  --target openai-gpt-5-6 `
  --profile controlled-write-approval `
  --credential-env OPENAI_API_KEY
```

CLI 只读取进程环境变量；WebStorm 代码 Runner 会主动加载根目录 `.env`。因此日常执行优先使用代码 Runner。

## 9. 增加新的右键入口

如果要增加 Learning Suite，可以复制任一现有 `.mjs` 文件，只修改 Suite：

```js
await runEnvironmentConfiguredEvaluation({
  repositoryRoot,
  suiteId: 'learning',
});
```

不需要在代码里填写 Provider、Model、Key 或 Profile。

可选执行配置：

- `caseIds`：只运行 Suite 中指定的 Case；
- `repetitions`：覆盖 Suite 默认重复次数；
- `retainEnvironments`：保留临时工作区用于排查，默认关闭。

注意：不能省略 Suite Policy 中标记为 required 的 Case。

## 10. 常见问题

### 10.1 `MEGUMI_EVALUATION_TARGET is missing`

根目录 `.env` 没有明确选择 Target。添加：

```dotenv
MEGUMI_EVALUATION_TARGET=openai-gpt-5-6
```

Target ID 必须存在于 `evals/agent/config/targets/`。

### 10.2 `MEGUMI_EVALUATION_CREDENTIAL_ENV is missing`

添加实际 Key 所在的环境变量名称：

```dotenv
MEGUMI_EVALUATION_CREDENTIAL_ENV=OPENAI_API_KEY
```

然后确保真正的 Key 存在：

```dotenv
OPENAI_API_KEY=...
```

### 10.3 `ERR_DLOPEN_FAILED` 或 `NODE_MODULE_VERSION`

Megumi 的 `better-sqlite3` 同时用于 Node 测试和 Electron Desktop。执行过 Electron package/start 后，本地 native module 可能是 Electron ABI；WebStorm Runner 使用 Node ABI。

在 WebStorm npm 工具窗口找到并双击：

```text
rebuild:native:node
```

然后重新右键运行 Evaluation 文件。

这只是切换本地 native module 的运行时兼容版本，不修改业务代码或数据库。

### 10.4 Provider 返回 401 / credential error

检查：

- `MEGUMI_EVALUATION_TARGET` 对应的 Provider；
- `MEGUMI_EVALUATION_CREDENTIAL_ENV` 指向的变量；
- 该变量中的 Key 是否有效。

### 10.5 Provider 超时、限流或临时失败

先区分：

- Provider 请求没有成功；
- Agent Runtime 失败；
- Agent 正常执行但行为不满足 Grader。

相关信息位于 execution report 的 Diagnostic 和 Runtime Events。

### 10.6 `unexpected_approval`

Evaluation 遇到 Case 没有声明的审批请求。Runner 会停止该次执行，避免自动批准未预期操作。

检查：

- Case 的 `approvalScript`；
- Profile 的 Permission Mode；
- Tool 请求的 action/resource；
- 是否新增了审批行为但没有更新 Case。

### 10.7 Suite Failed，但 Agent 看起来回复正常

最终回复存在不代表用户目标完成。打开 `summary.md` 检查：

- 文件是否真的存在；
- 文件内容是否符合要求；
- 是否执行了验证工具；
- 是否发生预期的失败与恢复；
- 最终回复是否与客观证据一致。

## 11. 目录结构

```text
evals/agent/
├── cases/       单个任务、要求和 Grader
├── suites/      Case 集合和通过策略
├── config/
│   ├── targets/   Provider / Model
│   └── profiles/  工具、权限、网络和隔离
├── fixtures/    受控任务输入
├── runs/        可直接右键运行的代码入口
├── runner/      Product Runtime 执行与证据收集
├── graders/     客观规则与人工 Review 规则
└── reporters/   汇总、脱敏、报告和 Baseline
```

工作关系：

```text
代码 Runner 选择 Suite 和本地 Target
  → Suite 选择 Cases 与 Profile
  → Case 声明 Fixture、请求和 Graders
  → Product Runtime 真实执行 Agent
  → Evidence Collector 收集事实
  → Graders 得出 Case Verdict
  → Suite Policy 得出 Suite Verdict
  → Reporter 写入报告
```
