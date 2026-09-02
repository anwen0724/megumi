# Evaluation Adapters

Adapters 只替换真实产品的外部环境边界，不替换 Product Runtime：

- `controlled/` 固定外部搜索结果、权限决定、时钟和 Profile，使 Case 可重复执行；
- `live/` 使用真实外部依赖；
- `candidate-model.ts` 从显式 Run 配置解析候选模型，并只从指定环境变量建立只读凭据快照。

Evaluation 不读取正常产品 Home 中的模型配置或凭据，也不会把密钥写入 Case 或 Run 产物。
