# Evaluation Execution

本目录负责把 Task 变成一次隔离但真实的产品执行：安装 `initialState`、创建共享 `ProductRuntime`、按 `input.type` 调用公开 Host 入口、等待业务终态，并形成紧凑 Observation。这里不实现候选供给、推荐或偏好学习规则。
