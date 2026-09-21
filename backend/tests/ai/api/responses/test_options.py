"""Verify native Responses controls through actual SDK requests."""

import json
from dataclasses import replace

import pytest

from app.ai import Context, ModelCompat, ResponsesOptions, SimpleOptions


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "requested,off,mapped,expected",
    [
        (None, "none", {}, {"effort": "none"}),
        ("off", "disabled", {}, {"effort": "disabled"}),
        (None, None, {}, None),
        ("high", "none", {"high": "high-native"}, {"effort": "high-native", "summary": "auto"}),
        ("max", "none", {"xhigh": "xhigh"}, {"effort": "xhigh", "summary": "auto"}),
    ],
)
async def test_simple_reasoning_mapping(
    provider, responses_harness, requested, off, mapped, expected
):
    model = replace(
        provider.models[0],
        capabilities=replace(
            provider.models[0].capabilities, reasoning=True, reasoning_levels={"off": off, **mapped}
        ),
    )
    async with responses_harness(providers=[replace(provider, models=[model])]) as (
        models,
        http,
        requests,
    ):
        final = await models.complete_simple(
            model,
            Context(messages=[]),
            SimpleOptions(api_key="key", http_client=http, reasoning=requested),
        )
        assert final.stop_reason == "stop", final.error_message
        body = json.loads(requests[0].content)
        assert body.get("reasoning") == expected
        assert body.get("include") == (
            ["reasoning.encrypted_content"] if expected and "summary" in expected else None
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("supports_max", [True, False])
async def test_explicit_controls_and_final_payload_override(
    provider, responses_harness, supports_max
):
    model = replace(
        provider.models[0],
        compat=ModelCompat(supports_max_output_tokens=supports_max),
        capabilities=replace(provider.models[0].capabilities, reasoning=True),
        sampling_params={"temperature": 0.2},
    )
    observations = []

    async def hook(body, _):
        observations.append(dict(body))
        return {**body, "temperature": 0.8, "vendor": {"active": True}}

    async def response_hook(metadata, _):
        observations.append(metadata.status)

    async with responses_harness(providers=[replace(provider, models=[model])]) as (
        models,
        http,
        requests,
    ):
        response = models.stream(
            model,
            Context(messages=[]),
            ResponsesOptions(
                api_key="key",
                http_client=http,
                max_output_tokens=2,
                temperature=0.1,
                service_tier="priority",
                tool_choice="none",
                reasoning_summary="concise",
                sampling_params={"temperature": 0.4},
                on_payload=hook,
                on_response=response_hook,
            ),
        )
        first = await anext(aiter(response))
        assert first["type"] == "start" and observations[-1] == 200
        final = await response.result()
        assert final.stop_reason == "stop", final.error_message
        before, _status = observations
        assert before["temperature"] == 0.4
        body = json.loads(requests[0].content)
        assert body["temperature"] == 0.8 and body["vendor"] == {"active": True}
        assert body["reasoning"] == {"effort": "medium", "summary": "concise"}
        assert body["tool_choice"] == "none" and body["service_tier"] == "priority"
        assert body.get("max_output_tokens") == (16 if supports_max else None)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "retention,explicit,long,expected",
    [
        ("none", False, True, {}),
        ("short", False, True, {}),
        ("long", False, True, {"prompt_cache_retention": "24h"}),
        ("long", False, False, {}),
        ("none", True, True, {"prompt_cache_options": {"mode": "explicit"}}),
        ("short", True, True, {}),
        ("long", True, True, {"prompt_cache_options": {"ttl": "30m"}}),
        ("long", True, False, {}),
    ],
)
async def test_cache_modes_and_unicode_key(
    provider, responses_harness, retention, explicit, long, expected
):
    model = replace(
        provider.models[0],
        compat=ModelCompat(
            supports_explicit_prompt_cache_mode=explicit,
            supports_long_cache_retention=long,
            send_session_affinity_headers=False,
        ),
    )
    async with responses_harness(providers=[replace(provider, models=[model])]) as (
        models,
        http,
        requests,
    ):
        final = await models.complete(
            model,
            Context(messages=[]),
            ResponsesOptions(
                api_key="key", http_client=http, cache_retention=retention, session_id="🌸" * 70
            ),
        )
        assert final.stop_reason == "stop", final.error_message
        body = json.loads(requests[0].content)
        assert body.get("prompt_cache_key") == (None if retention == "none" else "🌸" * 64)
        assert {
            k: v for k, v in body.items() if k in ("prompt_cache_retention", "prompt_cache_options")
        } == expected
        assert "session_id" not in requests[0].headers


@pytest.mark.asyncio
@pytest.mark.parametrize("form", ["openai", "openrouter", "none"])
async def test_affinity_headers_respect_capability_and_caller(provider, responses_harness, form):
    model = replace(
        provider.models[0],
        compat=ModelCompat(
            session_affinity_format="openai" if form == "openai" else None,
            send_session_affinity_headers=form != "none",
        ),
    )
    async with responses_harness(providers=[replace(provider, models=[model])]) as (
        models,
        http,
        requests,
    ):
        final = await models.complete(
            model,
            Context(messages=[]),
            ResponsesOptions(
                api_key="key",
                http_client=http,
                cache_retention="none",
                base_url="https://openrouter.ai/api/v1" if form == "openrouter" else None,
                session_id="session-1",
                headers={"x-client-request-id": "caller"},
            ),
        )
        assert final.stop_reason == "stop", final.error_message
        headers = requests[0].headers
        assert headers["x-client-request-id"] == "caller"
        assert headers.get("session_id") == ("session-1" if form == "openai" else None)
        assert headers.get("x-session-id") == ("session-1" if form == "openrouter" else None)
