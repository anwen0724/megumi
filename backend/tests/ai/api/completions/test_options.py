"""Check protocol options and DeepSeek compatibility at the HTTP boundary."""

import json
from dataclasses import replace

import pytest

from app.ai import (
    AssistantMessage,
    CompletionsOptions,
    Context,
    ModelCapabilities,
    ModelCompat,
    SimpleOptions,
    TextContent,
    deepseek_provider,
)


@pytest.mark.asyncio
@pytest.mark.parametrize("override", [False, True])
async def test_deepseek_defaults_and_explicit_compat(sdk_harness, override):
    provider = deepseek_provider()
    model = provider.models[0]
    if override:
        model = replace(
            model,
            compat=ModelCompat(
                supports_developer_role=True,
                supports_store=True,
                supports_usage_in_streaming=False,
                max_tokens_field="max_completion_tokens",
            ),
        )
        provider = replace(provider, models=[model])
    async with sdk_harness(providers=[provider]) as (models, http, requests):
        final = await models.complete(
            model,
            Context(messages=[], system_prompt="Rule"),
            CompletionsOptions(api_key="key", http_client=http, max_output_tokens=321),
        )
        assert final.stop_reason == "stop", final.error_message
        payload = json.loads(requests[0].content)
        assert requests[0].url.host == "api.deepseek.com"
        assert payload["messages"] == [
            {"role": "developer" if override else "system", "content": "Rule"}
        ]
        assert payload["max_completion_tokens" if override else "max_tokens"] == 321
        assert ("store" in payload) == override
        assert ("stream_options" in payload) != override
        if not override:
            assert payload["stream_options"] == {"include_usage": True}
        assert "prompt_cache_key" not in payload


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "level,off_supported,expected",
    [
        (None, True, None),
        ("off", True, None),
        ("medium", True, "high"),
        ("xhigh", True, "high"),
        ("off", False, "low"),
    ],
)
async def test_deepseek_reasoning_mapping_and_assistant_replay(
    sdk_harness, level, off_supported, expected
):
    provider = deepseek_provider()
    model = replace(
        provider.models[0],
        capabilities=ModelCapabilities(
            reasoning=True,
            reasoning_levels={
                "off": "disabled" if off_supported else None,
                "minimal": "low",
                "low": "low",
                "medium": "high",
                "high": "high",
            },
        ),
    )
    history = Context(
        messages=[
            AssistantMessage(
                provider=model.provider,
                api=model.api,
                model=model.id,
                timestamp=0,
                content=[TextContent(text="prior")],
                stop_reason="stop",
            )
        ]
    )
    async with sdk_harness(providers=[replace(provider, models=[model])]) as (
        models,
        http,
        requests,
    ):
        final = await models.complete_simple(
            model,
            history,
            SimpleOptions(
                api_key="key",
                http_client=http,
                reasoning=level,
                temperature=0.4,
                tool_choice="none",
            ),
        )
        assert final.stop_reason == "stop", final.error_message
        payload = json.loads(requests[0].content)
        assert payload["thinking"] == {"type": "enabled" if expected else "disabled"}
        assert payload.get("reasoning_effort") == expected
        assert payload["messages"][0]["reasoning_content"] == ""
        assert payload["tool_choice"] == "none"
        assert payload.get("temperature") == (None if expected else 0.4)


@pytest.mark.asyncio
async def test_generic_protocol_does_not_send_deepseek_thinking(provider, sdk_harness):
    model = replace(
        provider.models[0],
        capabilities=ModelCapabilities(
            reasoning=True, reasoning_levels={"off": "none", "medium": "medium"}
        ),
    )
    async with sdk_harness(providers=[replace(provider, models=[model])]) as (
        models,
        http,
        requests,
    ):
        final = await models.complete_simple(
            model,
            Context(messages=[]),
            SimpleOptions(api_key="key", http_client=http, reasoning="medium"),
        )
        assert final.stop_reason == "stop", final.error_message
        payload = json.loads(requests[0].content)
        assert payload["reasoning_effort"] == "medium"
        assert "thinking" not in payload


@pytest.mark.asyncio
@pytest.mark.parametrize("replacement", [False, True])
async def test_sampling_and_payload_hook_are_final_authority(provider, sdk_harness, replacement):
    model = replace(provider.models[0], sampling_params={"temperature": 0.2, "top_p": 0.6})
    observed = []

    async def hook(payload, _):
        observed.append(dict(payload))
        if replacement:
            return {
                "model": "wire-alias",
                "messages": [{"role": "user", "content": "replacement"}],
                "stream": True,
                "extension": 17,
            }
        payload["temperature"] = 0.9
        payload["extension"] = 17

    async with sdk_harness(providers=[replace(provider, models=[model])]) as (
        models,
        http,
        requests,
    ):
        result = await models.complete(
            model,
            Context(messages=[]),
            CompletionsOptions(
                api_key="key",
                http_client=http,
                temperature=0.1,
                sampling_params={"temperature": 0.7},
                on_payload=hook,
            ),
        )
        assert result.stop_reason == "stop", result.error_message
        assert observed[0]["temperature"] == 0.7
        assert observed[0]["top_p"] == 0.6
        payload = json.loads(requests[0].content)
        assert payload["extension"] == 17
        assert payload["model"] == ("wire-alias" if replacement else "small")
        assert payload.get("temperature") == (None if replacement else 0.9)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "endpoint,retention,support,key_sent,long_sent",
    [
        ("https://api.openai.com/v1", "short", True, True, False),
        ("https://api.openai.com/v1", "none", True, False, False),
        ("https://proxy.test", "short", True, False, False),
        ("https://proxy.test", "long", True, True, True),
        ("https://api.deepseek.com", "long", False, False, False),
        ("https://proxy.test", None, True, True, True),
    ],
)
async def test_cache_fields_follow_endpoint_and_compat(
    provider, sdk_harness, endpoint, retention, support, key_sent, long_sent
):
    model = replace(provider.models[0], compat=ModelCompat(supports_long_cache_retention=support))
    session = "😀" * 63 + "尾多"
    async with sdk_harness(providers=[replace(provider, models=[model])]) as (
        models,
        http,
        requests,
    ):
        final = await models.complete(
            model,
            Context(messages=[]),
            CompletionsOptions(
                api_key="key",
                base_url=endpoint,
                http_client=http,
                session_id=session,
                cache_retention=retention,
                env={"MEGUMI_AI_CACHE_RETENTION": "long"},
            ),
        )
        assert final.stop_reason == "stop", final.error_message
        payload = json.loads(requests[0].content)
        assert payload.get("prompt_cache_key") == ("😀" * 63 + "尾" if key_sent else None)
        assert payload.get("prompt_cache_retention") == ("24h" if long_sent else None)


@pytest.mark.asyncio
@pytest.mark.parametrize("retention", ["none", "short"])
async def test_affinity_defaults_precede_header_overrides_and_transform(
    provider, sdk_harness, retention
):
    model = replace(
        provider.models[0],
        compat=ModelCompat(send_session_affinity_headers=True, session_affinity_format="openai"),
    )
    observed = []

    def transform(headers):
        observed.append(dict(headers))
        return {**headers, "x-client-request-id": None, "x-extra": "final"}

    async with sdk_harness(providers=[replace(provider, models=[model])]) as (
        models,
        http,
        requests,
    ):
        final = await models.complete(
            model,
            Context(messages=[]),
            CompletionsOptions(
                api_key="key",
                http_client=http,
                cache_retention=retention,
                session_id="session",
                headers={"session_id": "override"},
                transform_headers=transform,
            ),
        )
        assert final.stop_reason == "stop", final.error_message
        assert observed[0].get("x-session-affinity") == ("session" if retention != "none" else None)
        assert observed[0]["session_id"] == "override"
        assert requests[0].headers["session_id"] == "override"
        assert "x-client-request-id" not in requests[0].headers
        assert requests[0].headers["x-extra"] == "final"


@pytest.mark.asyncio
async def test_response_hook_precedes_start(provider, sdk_harness):
    observed = []

    async def on_response(response, _):
        observed.append((response.status, response.headers["x-request-id"]))

    async with sdk_harness() as (models, http, _):
        response = models.stream(
            provider.models[0],
            Context(messages=[]),
            CompletionsOptions(api_key="key", http_client=http, on_response=on_response),
        )
        async for event in response:
            if event["type"] == "start":
                assert observed == [(200, "native-id")]
        assert (await response.result()).stop_reason == "stop"


@pytest.mark.asyncio
async def test_explicit_thinking_controls_named_temperature(sdk_harness):
    provider = deepseek_provider()
    async with sdk_harness(providers=[provider]) as (models, http, requests):
        final = await models.complete(
            provider.models[0],
            Context(messages=[]),
            CompletionsOptions(
                api_key="key", http_client=http, thinking={"type": "enabled"}, temperature=0.7
            ),
        )
        assert final.stop_reason == "stop", final.error_message
        payload = json.loads(requests[0].content)
        assert payload["thinking"] == {"type": "enabled"}
        assert "temperature" not in payload
