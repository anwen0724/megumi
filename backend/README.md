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

## 模型目录维护

运行时仍只读取 `src/app/ai/providers/data/` 中的 JSON，不联网刷新。开发工具位于 AI 包内：

```powershell
uv run python -m app.ai.scripts.model_catalog fetch
uv run python -m app.ai.scripts.model_catalog generate
uv run python -m app.ai.scripts.model_catalog generate --write
uv run python -m app.ai.scripts.model_catalog check
```

- `fetch` 获取 models.dev，保存两家快照，不改运行时文件；只有此命令联网。
- `generate` 离线生成并预览差异；`--write` 才更新运行时 JSON 和 manifest。
- `check` 离线复现并比较，退出 0 表示一致，1 表示差异，2 表示输入或操作错误。
- 三个操作均可重复传 `--provider openai` / `--provider deepseek`；省略则选择所有登记供应商。
- 路径按包位置定位，不依赖当前工作目录。不读取 API key。Windows 如终端编码不同，可设置 `$env:PYTHONUTF8='1'` 查看中文报告。
- 所选目录全部校验后才写入；正常写入异常会恢复旧文件。若恢复失败，错误报告保留的备份路径；工具不承诺断电或并发维护事务。

### 输入与生成关系

`scripts/catalog_inputs/rules.json` 登记供应商、协议规则、精确排除、完整补充、字段修正和人工核对；`snapshots/<provider>.json` 由 fetch 维护。新增模型通过严格 `tool_call=true` 自动发现，不维护人工纳入名单。新增供应商使用相同源与协议时只需登记规则；新协议不由生成工具实现。

修正路径针对转换后的 Model 字段，`expected` 为转换值，缺失用 `{"missing": true}`，与 null 区别。当前值匹配 expected 才替换；已经等于 replacement 时报告冗余；其它变化要求重新核对。数组整体替换，禁止身份修正和重叠修正。变更币种或单位必须提供完整 pricing 对象，不能改标签混用费率。完整补充只用于上游缺失的、有依据的模型。

维护输入和产物应一起提交；不要直接编辑生成 JSON。manifest 保存输入/规则/生成器/产物哈希、字段依据及实际核对状态。Model.source 可以为 null；它表示没有人工核对记录，不阻止合法模型纳入。source 日期不是 fetch 日期。快照保留未映射的原始字段。

### 当前数据与核对边界

2026-09-20 实际获取后，OpenAI 48 条上游记录生成 37 个模型，DeepSeek 4 条生成 2 个。数量是本次结果，不是固定白名单。

DeepSeek 排除指向 Flash 的两个旧别名，保留 `deepseek-flash` 与 `deepseek-v4-pro`；人民币分时价格依据[中文价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)，推理与采样规则依据[思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)。高峰为北京时间工作日（不含中国法定节假日）09:00–12:00、14:00–18:00，其余为空闲；条件只保存，不自动判断日历或费用。

OpenAI 使用 USD，保留 Standard 适用范围、上下文分档及上游提供的其他服务档价格；部分 Fast 条目没有上游上下文范围，条件明确标为未知，不推算缺失费率。排除仅支持 Realtime 的 `gpt-realtime-2.1`；`gpt-5.6` 排除依据是 [pi 明确记录的无效别名](https://github.com/earendil-works/pi/blob/e98f287ee/packages/ai/scripts/generate-models.ts)，不是本项目真实调用验证。抽查 GPT-4.1、GPT-5 Pro、GPT-6 Astra 的官方限制/能力及[官方价格](https://developers.openai.com/api/docs/pricing)，没有逐一复核全部 37 个模型。

价格保持 Decimal 精度，None 表示未知；需要条件才能确定的费率放在 PricingTier，无条件基础价保持未知。没有费用引擎、供应商推理调用或账号可用性验证。自定义 Provider 的完整替换契约不变。

## 验证

```powershell
uv run pytest tests/ai
uv run ruff check src/app tests/ai
uv run ruff format --check src/app tests/ai
uv run mypy src/app
```

新测试使用合成配置、虚构凭据和内存存储，包含独立进程的禁网验证；没有真实供应商联调。旧源码与全部旧测试保留在各自目录的 `.archive/2026-09-20-before-ai-rewrite/` 中，不参与新实现和测试发现。
