"""Where a provider's discovered model catalogue is kept between runs.

A provider with a dynamic catalogue publishes what it found, so the next start can offer
those models before any network access, and a caller that is offline still sees the last
known list. The stored entry is a snapshot: a reader must not be able to change what the
store holds, and a writer must not be able to change an entry a reader already holds.
"""

from __future__ import annotations

from collections.abc import Awaitable
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

__all__ = ["InMemoryModelsStore", "ModelsStore", "ModelsStoreEntry", "ModelsStoreOperationOptions"]


@dataclass(slots=True)
class ModelsStoreEntry:
    """One provider's stored catalogue and when it was checked."""

    models: list[Any] = field(default_factory=list)
    checkedAt: int = 0


@dataclass(slots=True)
class ModelsStoreOperationOptions:
    """How a store operation may be cancelled."""

    signal: Any = None


@runtime_checkable
class ModelsStore(Protocol):
    """A place to keep one catalogue entry per provider."""

    def read(
        self,
        provider: str,
        options: ModelsStoreOperationOptions | None = None,
    ) -> Awaitable[ModelsStoreEntry | None]:
        """The stored entry for ``provider``, or ``None`` when nothing is stored."""
        ...

    def write(
        self,
        provider: str,
        entry: ModelsStoreEntry,
        options: ModelsStoreOperationOptions | None = None,
    ) -> Awaitable[None]:
        """Store ``entry`` for ``provider``."""
        ...

    def delete(
        self,
        provider: str,
        options: ModelsStoreOperationOptions | None = None,
    ) -> Awaitable[None]:
        """Forget ``provider``."""
        ...


def _copy_entry(entry: ModelsStoreEntry) -> ModelsStoreEntry:
    """Detach an entry so neither side can change the other's copy."""

    return ModelsStoreEntry(models=list(entry.models), checkedAt=entry.checkedAt)


class InMemoryModelsStore:
    """A catalogue store that keeps entries for the life of the process."""

    def __init__(self) -> None:
        self._entries: dict[str, ModelsStoreEntry] = {}

    async def read(
        self,
        provider: str,
        options: ModelsStoreOperationOptions | None = None,
    ) -> ModelsStoreEntry | None:
        del options
        entry = self._entries.get(provider)
        return _copy_entry(entry) if entry is not None else None

    async def write(
        self,
        provider: str,
        entry: ModelsStoreEntry,
        options: ModelsStoreOperationOptions | None = None,
    ) -> None:
        del options
        self._entries[provider] = _copy_entry(entry)

    async def delete(
        self,
        provider: str,
        options: ModelsStoreOperationOptions | None = None,
    ) -> None:
        del options
        self._entries.pop(provider, None)


def ensure_store(
    store: ModelsStore | None,
) -> ModelsStore:
    """The store to use, defaulting to the in-memory one."""

    return store if store is not None else InMemoryModelsStore()
