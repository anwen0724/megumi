"""Provider configuration declares identity, catalog and authentication sources."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from app.ai.model import Model


@dataclass(frozen=True, slots=True)
class Provider:
    """Configuration only; protocol declarations do not implement network calls."""

    id: str
    name: str
    base_url: str
    api: str
    env_var: str
    models: Sequence[Model] = ()
    headers: Mapping[str, str | None] = field(default_factory=dict)
