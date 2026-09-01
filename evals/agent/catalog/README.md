# Evaluation Catalog

`catalog/` 定义并校验 Evaluation 的声明式 Contract：

- `evaluation-case.ts`：五类顶层业务 Case 及其合法 Trigger、Completion、Evidence 和 Grading 字段；
- `evaluation-suite.ts`：Suite Contract；
- `evaluation-run-config.ts`：候选模型、Grader 模型、Profile、重复次数、并发、预算、Baseline 和输出目录；
- `evaluation-catalog.ts`：加载全部 JSON，校验 ID、版本、能力目录、评分维度和引用关系。

Catalog 只解释和验证评估定义，不执行产品业务。运行前应先执行：

```text
npm run eval:agent -- catalog validate
```
