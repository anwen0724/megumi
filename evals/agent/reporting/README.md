# Evaluation Reporting

`reporting/` 消费已验证的 Run Result，不参与被测业务执行：

- 将逐 Task、逐 Metric 结果渲染为 Markdown 报告；
- 导入可选人工复核；
- 人工批准 Baseline，并按相同 Task、Revision、Profile 和模型版本比较后续 Run；
- 清理超过本地保留策略的旧 Run。

Baseline 是明确批准的比较基准，不是正确答案，也不会取代 Task 当前声明的必需 Metrics。
