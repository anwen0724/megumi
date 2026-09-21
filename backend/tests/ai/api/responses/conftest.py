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
