# 记忆效果评估

本目录保存记忆评估的样本、执行入口、评分和结果。评估使用虚构会话及正式 Memory、Coding 实现。桌面界面验收仍位于 `scripts/memory/`。

## 已运行的结果

2026-10-08 的 72 次实验归档在 `records/memory-p6-effects-verified/`。原目录 `.tmp/memory-p6-effects-verified/` 同时保留。迁移复制了 1,192 个文件，共 108,445,066 字节，逐文件 SHA-256 一致。迁移没有调用模型，也没有修改旧评分。

- `manifest.json`：当时的代码版本、固定样本、模型和条件。
- `results.json`：各次运行的结果索引。
- `summary.json`：当时的汇总。
- `human-review.json`：当时由编码 Agent 逐项核对的记录，文件名不代表独立真人评审。
- `<场景>-<条件>-<重复序号>/`：原始请求、响应、任务结果、记忆生成状态、记忆文件和观测记录。

历史 JSON 中的绝对路径保留原值，用于追溯。汇总脚本从指定归档目录读取逐次材料，不依赖原目录继续存在。`records/` 仅保存在本地，不提交 Git。

旧汇总的记忆成功数为 20/24，完整历史为 24/24。其中分页方式和审计记录字段的题目存在歧义，20/24 不作为最终准确率。当前样本版本为 2，明确了这两个字段的含义；旧归档里的样本和结果不变。新旧题目不同，不能直接用分数变化证明产品改善。

## 选择与预览

在仓库根目录执行命令。查看场景列表：

```powershell
npm run eval:memory -- --list
```

预览单个场景及运行条件，不调用模型：

```powershell
npm run eval:memory -- --fixtures preference-report --conditions none,full-history,memory --repeats 2 --preview .tmp/memory-preview.json
```

`--fixtures` 接受逗号分隔的场景 ID；省略时选择全部场景。`--conditions` 默认为 `none,full-history,memory`，分别表示无自动记忆、完整历史和使用记忆。`--repeats` 默认为 2。预览按实际选择计算任务数和记忆生成次数。

只执行 `npm run eval:memory` 会显示用法。只有显式带 `--run` 时才调用模型。

## 运行

以下命令会发送选定的虚构材料并消耗模型额度。当前这轮工作只迁移代码和归档，真实重跑仍待用户确认。

```powershell
# 单个场景
npm run eval:memory -- --fixtures preference-report --run

# 全部场景：12 组 × 3 个条件 × 2 次，共 72 次任务
npm run eval:memory -- --run
```

脚本使用当前配置的默认会话模型；模型配置从 `MEGUMI_HOME` 或默认 Megumi Home 读取。每次任务使用隔离数据库和虚构会话，不读取真实聊天记录。执行模型调用前需确保 SQLite 原生模块可在 Node.js 中加载；关闭开发应用后可执行 `npm run rebuild:native:node`。再次启动应用时，`npm start` 会重建 Electron 原生模块。

每次运行自动创建 `records/run-<唯一后缀>/`。也可用 `--output <新目录>` 指定位置；已有目录会被拒绝。脚本逐次保存结果，失败样本保留 `failure.json`，不以成功样本替换失败记录。

## 离线汇总

汇总不调用模型。指定已有实验目录和一个尚不存在的输出目录；输出的父目录应已存在：

```powershell
npm run eval:memory:summary -- evals/memory/records/memory-p6-effects-verified --out evals/memory/records/review-20261008
```

输出包含 `summary.json` 和 `review-template.json`，不会改写输入实验、原汇总或原判读记录。需要修订判读时，编辑模板的副本，再通过 `--review <文件>` 指定它，并使用新的 `--out` 目录。

未判读的字段保留 `null`。知识点机械匹配、逐项判读与 Spec 效果验收是不同结论。报告分别记录任务和后台提取／整合成本；这批短历史样本没有验证长期摊销收益，也没有验证实际执行任务的试错节省。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `effect-fixtures.ts` | 虚构历史、后续任务、知识点和禁止误用的信息 |
| `verify-effects.ts` | 场景选择、预览、真实执行和原始证据保存 |
| `effect-scoring.ts` | 输出字段的机械匹配 |
| `effect-review.ts` | 汇总逐知识点判读 |
| `summarize-effects.ts` | 只读实验记录，生成新的汇总与判读模板 |

类型检查：`npm run typecheck:evals`。样本和评分回归测试保留在 `tests/packages/memory/effect-fixtures.test.ts`、`effect-review.test.ts`。
