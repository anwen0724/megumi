"""Create DeepSeek configuration without SDK or network side effects."""

from collections.abc import Mapping, Sequence
from importlib.resources import files

from app.ai.catalog import load_catalog, snapshot_provider
from app.ai.model import Model
from app.ai.provider import Provider


def deepseek_provider(
    *,
    base_url: str = "https://api.deepseek.com",
    models: Sequence[Model] | None = None,
    headers: Mapping[str, str | None] | None = None,
) -> Provider:
    """Use a complete custom catalog when supplied, including an empty catalog."""
    catalog = (
        load_catalog(files(__package__).joinpath("data/deepseek.json").read_text(encoding="utf-8"))
        if models is None
        else models
    )
    return snapshot_provider(
        Provider(
            id="deepseek",
            name="DeepSeek",
            api="openai-completions",
            base_url=base_url,
            env_var="DEEPSEEK_API_KEY",
            models=catalog,
            headers=headers if headers is not None else {},
        )
    )
