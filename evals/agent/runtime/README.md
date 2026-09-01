# Evaluation Runtime

`runtime/` 隐藏 Task 作者不需要处理的执行复杂度：

```text
加载并校验 Task
  → 创建隔离 Home、数据库与 Workspace
  → 安装 Task Scenario
  → 调用 Runner 执行真实产品业务
  → 收集 Evidence 与 Measurements
  → 分派 Metrics
  → 汇总 Task Result 和 Run Result
  → 释放资源
```

每个 Task 独立装配和清理。单个 Task 失败会形成 `evaluation_error`，不会污染其他 Task。Evidence 包含业务输入、执行前后事实、完成事实、全部关联 Trace、Runtime Event、最终 Workspace 文件和 Measurements；它不是第二套业务状态。
