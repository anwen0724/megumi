"""Create OpenAI configuration without SDK or network side effects."""

from collections.abc import Mapping, Sequence
from importlib.resources import files

from app.ai.api.responses.adapter import openai_responses_api
from app.ai.auth.helpers import env_api_key_auth
from app.ai.auth.types import ProviderAuth
from app.ai.catalog import load_catalog, snapshot_provider
from app.ai.model import Model
from app.ai.provider import Provider, create_provider


def openai_provider(
    *,
    base_url: str = "https://api.openai.com/v1",
    models: Sequence[Model] | None = None,
    headers: Mapping[str, str | None] | None = None,
) -> Provider:
    """Use a complete custom catalog when supplied, including an empty catalog."""
    catalog = (
        load_catalog(files(__package__).joinpath("data/openai.json").read_text(encoding="utf-8"))
        if models is None
        else models
    )
    return snapshot_provider(
        create_provider(
            id="openai",
            name="OpenAI",
            api=openai_responses_api(),
            base_url=base_url,
            auth=ProviderAuth(api_key=env_api_key_auth("openai API key", ["OPENAI_API_KEY"])),
            models=catalog,
            headers=headers if headers is not None else {},
        )
    )
