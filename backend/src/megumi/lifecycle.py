"""Owns the ordered disposal of resources acquired during application startup.

Resources are registered in acquisition order and released in reverse order, so a
partially started application still shuts down cleanly. This is the Python
counterpart of the try/finally unwind that a composition root would otherwise
repeat inline.
"""

from __future__ import annotations

from collections.abc import Callable
from types import TracebackType
from typing import Self

DisposeCallback = Callable[[], None]


class Lifecycle:
    """A stack of cleanup callbacks released in reverse registration order."""

    def __init__(self) -> None:
        self._callbacks: list[DisposeCallback] = []
        self._disposed = False

    @property
    def disposed(self) -> bool:
        return self._disposed

    def on_dispose(self, callback: DisposeCallback) -> None:
        """Registers a cleanup callback, called last-registered-first."""

        self._callbacks.append(callback)

    def dispose(self) -> None:
        """Runs every cleanup callback once, collecting failures instead of stopping."""

        if self._disposed:
            return
        self._disposed = True
        failures: list[str] = []
        first_error: BaseException | None = None
        while self._callbacks:
            callback = self._callbacks.pop()
            try:
                callback()
            except BaseException as error:  # noqa: BLE001 - cleanup must continue
                failures.append(getattr(callback, "__qualname__", repr(callback)))
                if first_error is None:
                    first_error = error
        if first_error is not None:
            raise RuntimeError(
                f"{len(failures)} cleanup callback(s) failed: {', '.join(failures)}"
            ) from first_error

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.dispose()
