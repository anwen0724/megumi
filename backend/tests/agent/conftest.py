"""Synthetic provider configuration for Agent boundary tests."""

import pytest

from app.ai import (
    Model,
    Provider,
    ProviderAuth,
    create_provider,
    env_api_key_auth,
    openai_completions_api,
)


@pytest.fixture
def provider() -> Provider:
    """Provide a registered model without using a real supplier account."""
    return create_provider(
        id="sample",
        name="Sample",
        base_url="https://example.test/v1",
        api=openai_completions_api(),
        auth=ProviderAuth(api_key=env_api_key_auth("API key", ["SAMPLE_API_KEY"])),
        models=[
            Model(
                id="small",
                name="Small",
                provider="sample",
                api="openai-completions",
                context_window=4096,
                max_output_tokens=512,
            )
        ],
    )
