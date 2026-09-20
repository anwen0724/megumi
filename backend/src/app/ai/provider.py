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
    api: str | tuple[str, ...]
    env_var: str
    models: Sequence[Model] = ()
    headers: Mapping[str, str | None] = field(default_factory=dict)

    @property
    def apis(self) -> tuple[str, ...]:
        """规范化声明以供目录校验。这里不持有可执行适配器。"""
        return (self.api,) if isinstance(self.api, str) else self.api
