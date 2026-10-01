# Pi AI 来源与裁剪

迁入日期：2026-10-02。

## 来源

- 仓库：<https://github.com/earendil-works/pi>。
- 本次来源：用户更新后的本地工作树 `C:/all/work/github-reference-project/pi/packages/ai`。
- 提交：`6f1072cc081f06b86a673bd142f03720d17afe15`。
- 上游包名：`@earendil-works/pi-ai`；包内版本为 `0.99.2`，实际源码包含该发布版之后的提交。
- 本地包名：`@megumi/ai`。保留上游 MIT 许可证及作者信息。

该提交号只用于追溯本次复制来源，不要求后续更新继续使用这个版本。

## 保留范围

- Anthropic：`anthropic`。
- DeepSeek：`deepseek`。
- Moonshot AI：`moonshotai`、`moonshotai-cn`、`kimi-coding`。
- MiniMax：`minimax`、`minimax-cn`。
- OpenAI：`openai`、`openai-codex`。
- 智普：`zai`、`zai-coding-cn`，沿用上游 Coding Plan 端点。

保留所选入口的上游模型生成规则及 OAuth 能力。具体模型数据由本次迁入的生成器从 models.dev 获取，并应用上游已有的补充和兼容修正；生成时间及哈希见 `src/providers/data/.manifest.json`。

协议实现保留 `anthropic-messages`、`openai-completions`、`openai-responses`、`openai-codex-responses`。其他供应商的工厂、目录、专用协议、OAuth 流程和依赖已裁剪。通用消息、模型集合、认证、流、图像及分类类型接口沿用上游；当前没有注册图像生成或分类模型。

## 本地调整

- 包名、子路径引用、CLI 名称和构建配置适配工作区。AI 包使用与上游一致的 ES2024 / Node 类型环境。
- 独立构建明确生成 JavaScript 与声明文件，并使用独立的增量缓存，避免继承工作区的仅声明输出设置。
- 裁剪 Provider 注册、协议导出、认证装配、环境变量发现和模型生成输入。生成器在输出前校验供应商清单，不能生成清单以外的供应商。
- 保留公共协议代码中的兼容分支；它们不等于注册对应供应商，也不引入被裁剪的 SDK。
- 同步 OpenAI、Anthropic、TypeBox、代理依赖及锁文件。`pi-telemetry` 作为上游公共类型的依赖保留，没有新增 Megumi 遥测接入。
- 移除旧 `ImagesModels` 实现及 `onProviderExchange` 补丁，采用上游现有接口。
- 复用选定的上游离线测试，增加独立测试配置；现有 AI 包范围测试同步裁剪。

## 留待后续的调用方适配

本次只执行源码迁入、AI 包替换和供应商裁剪，未修改 `packages/agent`、`packages/agent-core`、`apps` 或 Eval。

- 现有模型装配仍引用已删除的 Google 协议入口。
- Agent 执行代码和相关调用方测试仍依赖已删除的 `ProviderExchange` / `onProviderExchange`。
- 模型设置、消息及工具结果的调用方类型需要在后续结构调整时检查。

因此 AI 包的独立验证不代表整个应用已经完成迁移或能够构建。

## 本次验证

- 生成目录包含 11 个 Provider、100 个聊天模型；没有其他供应商、图像生成或分类模型。
- 模型数据校验、AI 包独立类型检查、离线构建通过。
- 从编译产物导入模型目录和 Bun OAuth 装配入口通过。
- 独立测试配置：12 个测试文件、116 项测试通过，未调用真实模型服务。
- `npm test` 的 SQLite 重建步骤因预编译文件下载失败、回退编译缺少 ClangCL 而失败；随后直接运行 Vitest 完成上述 AI 测试，未调整 SQLite 配置。
- 未执行整应用构建和调用方迁移。

## 后续增加供应商

从届时采用的上游源码迁入 Provider、所需协议和认证，更新 `providers/all.ts`、已知类型、相关导出及生成器保留清单，补回对应的模型生成分支和依赖，然后重新生成数据并验证。不要手改生成的模型文件。
