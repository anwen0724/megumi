# Evaluation Execution

本目录负责把 Task 变成一次隔离但真实的产品执行：安装 `initialState`、创建共享 `ProductRuntime`、按 `input.type` 调用公开 Host 入口、等待公开业务完成事实，并形成 Observation。`execution-process.ts` 只把 Product Host 读取到的正常 Trace 按 Attempt、Trace 和原始 sequence 投影为可读步骤，不写 Trace，也不实现候选供给、推荐或偏好学习规则。
