"""Isolated synthetic configuration samples for the new AI contracts."""

import pytest

from app.ai.model import Model
from app.ai.provider import Provider


@pytest.fixture
def provider() -> Provider:
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
