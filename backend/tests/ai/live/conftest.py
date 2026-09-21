"""Gate real provider tests before credentials or any network resource are used."""

import os
from datetime import UTC, datetime
from importlib.metadata import version

import pytest
import pytest_asyncio

from app.ai import Models, deepseek_provider, openai_provider


@pytest.fixture(autouse=True)
def isolated_credential_environment():
    """Override the offline credential scrubber only for explicitly enabled live tests."""
    if os.getenv("MEGUMI_AI_LIVE") != "1":
        pytest.skip("Real provider verification requires MEGUMI_AI_LIVE=1")


@pytest.fixture
def live_model(request, record_property):
    """Select a caller-specified catalog ID and record only non-secret run metadata."""
    provider_id = getattr(request, "param", "deepseek")
    prefix = provider_id.upper()
    identity = os.getenv(f"MEGUMI_AI_LIVE_{prefix}_MODEL", "").strip()
    if not identity or not os.getenv(f"{prefix}_API_KEY", "").strip():
        pytest.fail(
            f"Live verification needs {prefix}_API_KEY and MEGUMI_AI_LIVE_{prefix}_MODEL",
            pytrace=False,
        )
    provider = openai_provider() if provider_id == "openai" else deepseek_provider()
    api = "openai-responses" if provider_id == "openai" else "openai-completions"
    model = next((item for item in provider.models if item.id == identity), None)
    if model is None or model.provider != provider_id or model.api != api:
        pytest.fail(f"Selected model is absent from the {provider_id} {api} catalog", pytrace=False)
    record_property("provider", provider_id)
    record_property("verified_at", datetime.now(UTC).isoformat())
    record_property("catalog_model", model.id)
    record_property("sdk_version", version("openai"))
    return provider, model


@pytest_asyncio.fixture
async def live_models(live_model):
    """Own one real request runtime per test; credentials remain in the process environment."""
    provider, _ = live_model
    models = Models([provider])
    try:
        yield models
    finally:
        await models.aclose()


@pytest.fixture
def record_final(record_property):
    """Retain IDs and terminal outcomes without logging prompts, bodies, or credentials."""

    def record(final):
        record_property("response_model", final.response_model or final.model)
        record_property("stop_reason", final.stop_reason)
        record_property("response_id", final.response_id or "")

    return record
