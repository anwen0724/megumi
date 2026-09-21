# Megumi Python AI

当前实现模型与供应商管理、消息与上下文，以及模型调用运行时：后台事件流、独立结果、两层重试、预算、请求钩子、取消和 SDK/HTTP 资源管理。可独立于 FastAPI 使用。Chat Completions 已接入官方 SDK，包含 DeepSeek 兼容处理；Responses 和 Agent Core 尚未实现。协议已经过实际 SDK + 模拟 HTTP 验证，DeepSeek 真实联调尚未执行。

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

也可以通过 `DEEPSEEK_API_KEY`、`OPENAI_API_KEY` 提供凭据。解析顺序为单次显式 key → 存储 → 对应环境变量。有效显式 key 不读取后两者；存储故障或显式/存储空白 key 报错，不回退。环境变量缺失、空字符串或纯空白均表示该 key 来源未配置。所有 key 来源缺少时，最终有效 Authorization 可单独完成认证；此时 ResolvedAuth.key 为 None、source 为 headers。头认证不掩盖空 key 或存储故障。

`get_available_models(provider=None)` 只检查所选供应商的本地认证配置：按供应商检查 key、逐模型合并静态授权头，未配置时排除该模型；存储故障或非法凭据使整次查询报错，可单独查询正常供应商。它不证明账号权限、余额或远端可达性。

`get_model` 查不到返回 None；`get_models` 查不到返回空元组。设置和查询均隔离嵌套配置；非法替换保留原集合。`get_provider/get_providers` 查询供应商快照，`delete_provider/clear` 删除配置而不删除凭据。Provider.api 可以是单个协议字符串或多个协议的元组；这里只校验声明，不代表已经实现调用。

headers 按供应商、模型、认证产生的默认 Bearer、单次覆盖合并，名称不区分大小写，None 删除字段。Authorization 可覆盖或删除，Host/Content-Length 与非法换行仍拒绝。`AuthOverride` 的 `base_url` 覆盖本次端点，`env` 只覆盖本次环境读取（未指定名称查外部环境、None 遮蔽外部值），`transform_headers` 可同步或异步返回最终头；原始参数及进程环境不会被修改。

`aclose` 阻止新生成、取消并等待活动请求、关闭自有 HTTP 客户端；静态设置、查询和认证检查仍可用。关闭幂等，外部注入客户端由调用方关闭。

Model 的 `sampling_params` 保存 JSON 采样默认，`compat` 保存两协议的可选覆盖，None 交由协议默认决定。`ModelCapabilities.reasoning` 独立声明推理能力；`reasoning_levels` 的 null 表示不支持，普通等级缺省允许，xhigh/max 需要显式声明。`get_supported_thinking_levels` 返回支持列表，`clamp_thinking_level` 对不支持等级先向上、再向下寻找；不支持推理时仅 off。

## 消息、工具参数与生成进度

消息与上下文接口可以独立使用：system 正文/section/工具声明重放、跨模型历史转换及缺失工具结果补齐、普通 JSON 保存恢复、工具参数解析与验证、strict Schema 转换、消息帧及 Decimal 费用计算。

```python
from app.ai import (
    Context, UserMessage, ToolDefinition,
    normalize_context, encode_messages, decode_messages,
    parse_partial_arguments, validate_tool_arguments,
)

context = Context(
    system_prompt="Answer briefly.",
    messages=[UserMessage(content="Hello", timestamp=1)],
)
transcript = normalize_context(context)
saved = encode_messages(transcript.messages)
assert decode_messages(saved) == transcript.messages

tool = ToolDefinition(
    name="weather",
    description="Query weather",
    parameters={
        "type": "object",
        "properties": {"city": {"type": "string"}},
        "required": ["city"],
    },
)
parsed = parse_partial_arguments('{"city":"Beijing"}')
arguments = validate_tool_arguments(tool, parsed)
assert arguments == {"city": "Beijing"}
```

`parse_partial_arguments` 保留数组、标量与完整 null 等解析结果；`validate_tool_arguments`/`validate_tool_call` 成功才返回独立参数字典。不执行工具、不插默认值，原生 null 不转为数字/布尔/字符串。`make_strict_json_schema` 与 `resolve_json_schema_strict_sampling` 按已支持的 Schema 子集处理 prefer/require。

`transform_messages` 接收消息序列、目标 Model 和可选工具 ID 回调，返回新历史。图片占位、签名转换及缺失结果补齐不写回原会话。`resolve_transcript` 与 `resolve_transcript_tools` 分别判断指令位置和工具新增锚点；同名再次声明即使内容相同也退出 additions-only。

`AssistantMessageFrameEncoder.encode` 接收事件数据并返回独立帧或 None；`reduce_assistant_message_frames` 返回独立 partial，没有 start 则返回 None。事件使用 TypedDict，partial/内容块使用消息 dataclass；帧的 JSON 保存和读取可通过 `pydantic.TypeAdapter(list[AssistantMessageFrame])` 完成。保存位置由调用方选择，最终 done/error 消息另存。模型调用运行时会产生统一事件；Chat Completions 已实现原生事件转换；Responses 尚未实现。

`calculate_usage_cost(usage, pricing, ...)` 返回独立 UsageCost，不改 Usage。input 已排除缓存，reasoning 不重复收费；未知计数或费率保持 None。响应 service_tier 优先于请求值，不能证明适用的服务档不使用基础价。`condition_matches` 由调用方在有效服务档下给出各条件是否适用，键为现有 PricingTier.condition 原文；函数不解析条件描述。未知或多项竞争条件不能确定唯一价格时保持未知；已知零计数可为零费用。

## 模型调用运行时

`Models.stream` / `stream_simple` 在运行中的事件循环内立即返回 `AssistantResponse`；生产在后台执行，不依赖事件迭代。`complete` / `complete_simple` 使用同一路径并返回最终消息。已内置 `openai-completions`，显式 `adapters` 同名配置优先。`openai-responses` 仍返回未绑定协议错误。

以下示例会真实请求 DeepSeek，需要预先配置 `DEEPSEEK_API_KEY`，命令行传入当前目录中的模型 ID：

```python
import asyncio
import sys
from app.ai import Context, SimpleOptions, UserMessage, create_models, deepseek_provider

async def ask(model_id: str):
    models = create_models([deepseek_provider()])
    try:
        model = models.get_model("deepseek", model_id)
        if model is None:
            raise ValueError("Model ID is absent from the local DeepSeek catalog")
        response = models.stream_simple(
            model,
            Context(messages=[UserMessage(content="Hello", timestamp=0)]),
            SimpleOptions(reasoning="off", max_output_tokens=512),
        )
        async for event in response:
            if event["type"] == "text_delta":
                print(event["delta"], end="", flush=True)
        final = await response.result()
        if final.stop_reason in ("error", "aborted"):
            raise RuntimeError(final.error_message)
        await response.aclose()
    finally:
        await models.aclose()

asyncio.run(ask(sys.argv[1]))
```

只需要最终消息时使用 `complete_simple`。显式协议调用使用 `CompletionsOptions`，支持 `reasoning_effort`、`thinking`、`tool_choice` 和公共控制参数。模型/请求 `sampling_params` 在命名字段之后合并，`on_payload` 最后执行。

同一 Completions 适配器服务声明该 API 的不同 Provider。已知 DeepSeek 身份或地址提供兼容默认，显式 `Model.compat` 优先；默认 system/max_tokens、不发送 store、按目录等级映射 thinking。缓存字段和亲和头受端点、缓存模式和兼容配置控制；亲和默认头也经过供应商/模型/请求覆盖及最终 `transform_headers`。

等待 `result()` 或下一条事件的任务被取消时，只结束该等待者；显式 `response.cancel()`、`await response.aclose()`、请求 `signal.set()` 或 `Models.aclose()` 才停止生成。`complete*` 拥有内部响应，其任务取消会等待清理后传播 `CancelledError`。停止事件迭代不自动取消生成。事件队列不是广播订阅。

协议处理完成后发布一次 done/error 并完成 result，后台继续释放剩余资源。`response.aclose()` / `Models.aclose()` 等待清理完成；即使某项失败也继续其他清理，最后通过 `ExceptionGroup` 报告失败。清理错误不改写已发布消息，已结束请求的清理失败仍由 Models 保留。SDK 在迭代退出时进行的清理保持原顺序。保存活动状态使用消息帧，最终消息另存。

`CallOptions` 包含认证覆盖、采样、缓存/会话偏好、钩子、重试、超时与传输注入；`SimpleOptions` 增加 reasoning、tool_choice 和 thinking_budgets。模型默认采样与单次采样合并；mutable 数据复制，回调、signal、telemetry_context 和借用客户端保持身份。`on_payload` 可同步/异步修改或替换 payload，None 保留原地修改；它在重试外执行一次。`on_response` 只得到状态/headers，在成功建流后、start 前执行；钩子异常形成 error。

`http_client` 接收 `httpx2.AsyncClient`。锁定的 `openai==3.16.2` 使用 `httpx2==2.13.0`；共享 SDK 执行入口位于 `runtime/clients.py`，接收协议提供的 SDK 请求操作及最终 payload；协议操作分别调用 `chat.completions.create()` / `responses.create()`，不再固定使用底层 post。SSE 解码由 SDK 提供，业务消息解析归协议适配器。SDK 内部重试设为 0，共享请求策略默认也不额外尝试。请求 `timeout_ms` 仅在提供时传递，缺省沿用 SDK/传输默认值。SDK 的环境默认头不会覆盖已经解析的认证和头配置。

生成消息的 `diagnostics` 为可选 `AssistantMessageDiagnostic` 数组，每条包含 type/timestamp 和可选 error/details；编解码拒绝非法结构。它不承载结果发布后的清理错误。

显式启用整次 Assistant 调用重试的接口如下，`produce` 由调用方提供：

```python
from app.ai import RetryPolicy, retry_assistant_call

async def with_recovery(produce):
    return await retry_assistant_call(
        produce,
        RetryPolicy(enabled=True, max_retries=2, base_delay_ms=500),
    )
```

请求重试只覆盖建流，不重新发送已经开始读取的流；Assistant helper 只重试可恢复的 error 消息，默认不叠加两层策略。`estimate_context_tokens`、`is_context_overflow`、`is_recoverable_length` 提供估算与恢复判断，不改历史、不自动摘要或重发，未知用量保持未知。

Completions 协议测试走 Models → 内置适配器 → 实际 SDK → 模拟 HTTP；共享运行时测试仍可显式注入协议协作者。这些验证不代表 DeepSeek/OpenAI 已经联调。

## 模型目录维护

运行时仍只读取 `src/app/ai/providers/data/` 中的 JSON，不联网刷新。开发工具位于 AI 包内：

```powershell
uv run python -m app.ai.scripts.generate_models fetch
uv run python -m app.ai.scripts.generate_models generate
uv run python -m app.ai.scripts.generate_models generate --write
uv run python -m app.ai.scripts.generate_models check
```

- `fetch` 获取 models.dev，保存两家快照，不改运行时文件；只有此命令联网。
- `generate` 离线生成并预览差异；`--write` 才更新运行时 JSON 和 manifest。
- `check` 离线复现并比较，退出 0 表示一致，1 表示差异，2 表示输入或操作错误。
- 三个操作均可重复传 `--provider openai` / `--provider deepseek`；省略则选择所有登记供应商。
- 路径按包位置定位，不依赖当前工作目录。不读取 API key。Windows 如终端编码不同，可设置 `$env:PYTHONUTF8='1'` 查看中文报告。
- 所选目录全部校验后才写入；正常写入异常会恢复旧文件。若恢复失败，错误报告保留的备份路径；工具不承诺断电或并发维护事务。

### 代码组织

```text
src/app/ai/
├── scripts/
│   ├── __init__.py
│   └── generate_models.py       # fetch / generate / check 命令入口
├── catalog_generation/
│   ├── __init__.py
│   ├── source.py                # 上游获取、解析与规则输入读取
│   ├── generate.py              # 筛选、转换、修正、校验候选及来源清单
│   ├── output.py                # 差异比较、保存与失败恢复
│   └── inputs/
│       ├── openai.rules.json
│       ├── deepseek.rules.json
│       ├── openai.snapshot.json
│       └── deepseek.snapshot.json
└── providers/data/              # 运行时模型 JSON 与 manifest.json
```

每份规则文件包含 `schema_version: 1` 和该家的 `provider` 对象；文件名与 provider.id 一致。获取只访问公共上游，生成只使用已保存输入，输出模块负责文件更新；命令入口不承载这些业务实现。

### 输入与生成关系

`catalog_generation/inputs/<provider>.rules.json` 分别登记各供应商的协议规则、精确排除、完整补充、字段修正和人工核对；同目录的 `<provider>.snapshot.json` 由 fetch 维护。新增模型通过严格 `tool_call=true` 自动发现，不维护人工纳入名单。新增供应商使用相同源与协议时只需登记规则；新协议不由生成工具实现。

修正路径针对转换后的 Model 字段，`expected` 为转换值，缺失用 `{"missing": true}`，与 null 区别。当前值匹配 expected 才替换；已经等于 replacement 时报告冗余；其它变化要求重新核对。数组整体替换，禁止身份修正和重叠修正。变更币种或单位必须提供完整 pricing 对象，不能改标签混用费率。完整补充只用于上游缺失的、有依据的模型。

供应商规则可提供 `sampling_params` 和 `compat` 默认；修正支持整体 `sampling_params`、`capabilities.reasoning`/`reasoning_levels` 及已定义的 `compat` 字段，补充模型携带同样字段。完整补充须明确 reasoning 布尔值。上游明确 effort/toggle 集合之外的等级生成 null，避免加载后被当成默认支持。非法新字段在发布前失败，清单保留规则/修正/补充来源。

维护输入和产物应一起提交；不要直接编辑生成 JSON。manifest 保存输入/规则/生成器/产物哈希、字段依据及实际核对状态。Model.source 可以为 null；它表示没有人工核对记录，不阻止合法模型纳入。source 日期不是 fetch 日期。快照保留未映射的原始字段。

### 当前数据与核对边界

2026-09-20 实际获取后，OpenAI 48 条上游记录生成 37 个模型，DeepSeek 4 条生成 2 个。数量是本次结果，不是固定白名单。

DeepSeek 排除指向 Flash 的两个旧别名，保留 `deepseek-flash` 与 `deepseek-v4-pro`；人民币分时价格依据[中文价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)，推理与采样规则依据[思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)。高峰为北京时间工作日（不含中国法定节假日）09:00–12:00、14:00–18:00，其余为空闲；条件只保存，不自动判断日历或费用。

OpenAI 使用 USD，保留 Standard 适用范围、上下文分档及上游提供的其他服务档价格；部分 Fast 条目没有上游上下文范围，条件明确标为未知，不推算缺失费率。排除仅支持 Realtime 的 `gpt-realtime-2.1`；`gpt-5.6` 排除依据是 [pi 明确记录的无效别名](https://github.com/earendil-works/pi/blob/e98f287ee/packages/ai/scripts/generate-models.ts)，不是本项目真实调用验证。抽查 GPT-4.1、GPT-5 Pro、GPT-6 Astra 的官方限制/能力及[官方价格](https://developers.openai.com/api/docs/pricing)，没有逐一复核全部 37 个模型。

价格保持 Decimal 精度，None 表示未知；需要条件才能确定的费率放在 PricingTier，无条件基础价保持未知。已经提供基于已知用量和费率的费用计算；没有供应商推理调用或账号可用性验证。自定义 Provider 的完整替换契约不变。

## 验证

```powershell
uv run pytest tests/ai
uv run ruff check src/app tests/ai
uv run ruff format --check src/app tests/ai
uv run mypy src/app
```

新测试使用合成配置、虚构凭据和内存存储，包含独立进程的禁网验证；没有真实供应商联调。旧源码与全部旧测试保留在各自目录的 `.archive/2026-09-20-before-ai-rewrite/` 中，不参与新实现和测试发现。
