"""Synthetic Responses provider and hand-authored native terminal events."""

from dataclasses import replace

import pytest


@pytest.fixture
def provider(provider):
    return replace(
        provider,
        api="openai-responses",
        models=[replace(provider.models[0], api="openai-responses")],
    )


@pytest.fixture
def response_sse(native_sse):
    def response(*events):
        return native_sse(*events)

    return response


@pytest.fixture
def responses_harness(sdk_harness, response_sse):
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def harness(**kwargs):
        kwargs.setdefault(
            "data",
            response_sse(
                {
                    "type": "response.completed",
                    "response": {"id": "r", "status": "completed", "output": []},
                }
            ),
        )
        async with sdk_harness(**kwargs) as result:
            yield result

    return harness
