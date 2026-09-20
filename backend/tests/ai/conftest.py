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


@pytest.fixture(autouse=True)
def isolated_credential_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Prevent real credentials from entering any new AI contract test."""
    for name in ("DEEPSEEK_API_KEY", "OPENAI_API_KEY", "SAMPLE_API_KEY", "OTHER_API_KEY"):
        monkeypatch.delenv(name, raising=False)
