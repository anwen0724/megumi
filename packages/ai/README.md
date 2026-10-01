# @megumi/ai

从 Pi AI 源码迁入的独立 AI 包，负责模型目录、认证、统一消息与流式模型调用。来源和裁剪说明见 [UPSTREAM.md](./UPSTREAM.md)。

## 支持范围

- DeepSeek：`deepseek`。
- OpenAI：`openai`、`openai-codex`。
- Anthropic：`anthropic`。
- Moonshot AI：`moonshotai`、`moonshotai-cn`、`kimi-coding`。
- MiniMax：`minimax`、`minimax-cn`。
- 智普 Coding Plan：`zai`、`zai-coding-cn`。

保留这些入口在上游目录中的模型；实际目录以生成数据为准。图像输入能力由具体模型决定，目前不注册图像生成或分类模型。

## 使用

```typescript
import { builtinModels } from '@megumi/ai/providers/all';

const models = builtinModels();
const model = models.getModel('deepseek', 'deepseek-flash');
if (!model) throw new Error('Model not found');

// 凭据通过 CredentialStore 或该 Provider 的环境变量提供。
const result = await models.completeSimple(model, {
  messages: [{ role: 'user', content: '你好', timestamp: Date.now() }],
});
```

也可以通过 `createModels()` 和各 Provider 工厂只装配需要的入口。其余接口沿用 [Pi AI 文档](https://github.com/earendil-works/pi/blob/6f1072cc081f06b86a673bd142f03720d17afe15/packages/ai/README.md)，但该文档中的供应商范围以本包上述清单为准。

## 开发与验证

从仓库根目录执行：

```powershell
npm run generate-models --workspace @megumi/ai
npm run check:model-data --workspace @megumi/ai
npm run build:offline --workspace @megumi/ai
npm test -- --config packages/ai/vitest.config.ts
```

模型目录和 JSON 数据由生成器维护，已纳入版本管理。离线构建不重新获取模型目录。

测试配置只包含本包的离线测试和 `tests/packages/ai`，不需要真实模型凭据。项目测试入口会先重建 SQLite；若该环境步骤失败，可直接运行不依赖 SQLite 的 AI 测试：

```powershell
node node_modules/vitest/vitest.mjs run --config packages/ai/vitest.config.ts
```

当前仅完成 AI 包替换，Megumi 调用方的接入调整留待后续进行。
