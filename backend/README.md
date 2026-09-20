# Megumi Python AI

当前实现模型与供应商管理：静态目录、供应商原子替换、模型查询、API key 解析、请求配置快照以及关闭行为。可独立于 FastAPI 使用；尚不提供模型生成、SSE、协议适配器或 Agent Core。

## 使用

在 backend 目录执行 `uv sync --dev` 准备 Python >=3.12 环境。

```python
import asyncio
from dataclasses import replace

from app.ai import (
    ApiKeyCredential,
    AuthOverride,
    InMemoryCredentialStore,
    create_models,
    deepseek_provider,
    openai_provider,
)


async def main():
    credentials = InMemoryCredentialStore()
    # 示例值只用于展示本地配置，不是真实供应商凭据。
    await credentials.set("deepseek", ApiKeyCredential("fake-example-key"))
    models = create_models(
        [deepseek_provider(), openai_provider()],
        credentials=credentials,
    )
    try:
        model = models.get_model("deepseek", "deepseek-flash")
        assert model is not None
        print([(item.provider, item.id) for item in models.get_models()])
        print([item.id for item in await models.get_available_models()])

        # 内部调用层协作接口：只解析配置，不发送请求。不要记录 key 或 headers。
        resolved = await models.resolve_auth(
            model, AuthOverride(headers={"X-Request-Tag": "example"})
        )
        print(resolved.source, resolved.base_url)

        # 同 ID 完整替换；未列出的旧模型被移除，已保存的凭据保持不变。
        private_model = replace(model, id="private-model")
        models.set_provider(deepseek_provider(
            base_url="http://localhost:8080/v1",
            models=[private_model],
            headers={"X-Gateway": "local"},
        ))
        assert models.get_model("deepseek", "deepseek-flash") is None
    finally:
        await models.aclose()


asyncio.run(main())
```

也可以通过 `DEEPSEEK_API_KEY`、`OPENAI_API_KEY` 提供凭据。解析顺序为单次显式 key → 存储 → 对应环境变量。有效显式 key 不读取后两者；存储故障或显式/存储空白 key 报错，不回退。环境变量缺失、空字符串或纯空白均表示未配置。

`get_available_models(provider=None)` 只检查所选供应商的本地认证配置：未配置时排除该供应商；存储故障或非法凭据使整次查询报错，可单独查询正常供应商。它不证明账号权限、余额或远端可达性。

`get_model` 查不到返回 None；`get_models` 查不到返回空元组。设置和查询均隔离嵌套配置；非法替换保留原集合。headers 按供应商、模型、单次覆盖合并，名称不区分大小写，None 删除可选字段；Authorization、Host、Content-Length 不允许自定义。关闭后的服务操作抛 `LifecycleError`，重复关闭幂等，已查询的数据仍可使用。

## 静态目录

核对日期：2026-09-20。维护一个小型目录，支持使用工厂的 `models` 参数完整替换，空列表也有效。运行时不刷新、不联网、不推断私有模型能力。

| 内置模型 | 协议声明 | 数据依据 |
| --- | --- | --- |
| deepseek-flash | openai-completions | [模型与条件价格](https://api-docs.deepseek.com/quick_start/pricing/)、[推理与采样](https://api-docs.deepseek.com/guides/thinking_mode/)、[Token 限制数值表示](https://api-docs.deepseek.com/quick_start/agent_integrations/pi_mono/) |
| gpt-4.1 | openai-responses | [模型能力与限制](https://developers.openai.com/api/docs/models/gpt-4.1)、[标准 Token 价格](https://developers.openai.com/api/docs/pricing) |

价格采用 Decimal；未知费率为 None，明确免费才为零。OpenAI 保存标准处理 Token 费率，未计工具或特殊处理费用。DeepSeek 保存高峰/低峰条件分档，无条件费率为 None；分档描述包括 UTC 时段和中国法定节假日，不自动判断当前费率，也不计算费用。来源与核对日期保存在每条模型数据中。

DeepSeek 的 temperature 只在关闭推理时有效，由 `temperature_requires_reasoning_off` 声明。能力、推理映射和兼容字段目前只保存与校验；请求发送前的能力检查由后续调用层实现。

## 验证

```powershell
uv run pytest tests/ai
uv run ruff check src/app tests/ai
uv run ruff format --check src/app tests/ai
uv run mypy src/app
```

新测试使用合成配置、虚构凭据和内存存储，包含独立进程的禁网验证；没有真实供应商联调。旧源码与全部旧测试保留在各自目录的 `.archive/2026-09-20-before-ai-rewrite/` 中，不参与新实现和测试发现。
