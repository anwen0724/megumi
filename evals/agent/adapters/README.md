# Evaluation Adapters

Adapters 只替换真实产品的外部环境边界，不替换 Product Runtime：

- `controlled/` 固定外部搜索结果、权限决定、时钟和 ID，使重复运行可比较；
- `live/` 使用实时外部依赖，结果主要用于趋势观察；
- Credential 和 Home Adapter 保证密钥不进入产物、运行不接触用户正式 Home。
