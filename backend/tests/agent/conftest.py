"""Synthetic provider configuration for Agent boundary tests."""

import pytest

from app.ai import Model, Provider


@pytest.fixture
def provider() -> Provider:
    """Provide a registered model without using a real supplier account."""
    return Provider(
        id="sample",
        name="Sample",
        base_url="https://example.test/v1",
        api="openai-completions",
        env_var="SAMPLE_API_KEY",
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
