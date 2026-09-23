"""Gate real Agent model calls before accessing credentials or network."""

import os
from dataclasses import replace

import pytest

from app.ai import Model, Provider, deepseek_provider


@pytest.fixture(autouse=True)
def require_live_opt_in() -> None:
    """Keep this suite offline unless the existing live flag is explicit."""
    if os.getenv("MEGUMI_AI_LIVE") != "1":
        pytest.skip("Real Agent verification requires MEGUMI_AI_LIVE=1")


@pytest.fixture
def live_provider_and_model() -> tuple[Provider, Model]:
    """Select a registered DeepSeek model and cap output in the test host."""
    if not os.getenv("DEEPSEEK_API_KEY", "").strip():
        pytest.fail("DEEPSEEK_API_KEY is required for live verification", pytrace=False)
    provider = deepseek_provider()
    selected_id = os.getenv("MEGUMI_AI_LIVE_DEEPSEEK_MODEL", "").strip()
    if selected_id:
        model = next((item for item in provider.models if item.id == selected_id), None)
    else:
        model = next((item for item in provider.models if item.api == "openai-completions"), None)
    if model is None or model.api != "openai-completions":
        pytest.fail("Selected DeepSeek model is absent from the Completions catalog", pytrace=False)
    capped = replace(model, max_output_tokens=min(256, model.max_output_tokens))
    return replace(provider, models=[capped]), capped
