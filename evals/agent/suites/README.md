# Evaluation Suites

`suites/` 把若干独立 Case 组合成一次有明确目的的评估集合。Suite 不定义新的业务行为，也不修改 Case 的 Fixture 或评分规则。

主要字段：

- `suiteId`、`revision`：Suite 身份与版本；
- `title`、`purpose`：人工可读名称和运行目的；
- `profile`：该 Suite 使用 `controlled` 或 `live`；
- `caseIds`：按稳定 ID 引用的 Case；
- `sharedEnvironment`：是否声明共享环境；当前 Case Runner 默认保持每条 Case 独立装配和清理。

Run Config 通过 `suiteIds` 选择 Suite。Catalog 会确认所有 Case 均存在，并允许在 Suite 指定的 Profile 下运行。同一 Run 选择多个 Suite 时，重复引用的 Case 会去重，再按照 `repetitions` 独立执行。
