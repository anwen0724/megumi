"""The backend composition root: creates resources and guarantees their release.

``MegumiApp`` is the Python counterpart of a Spring Boot application context. It
owns the Megumi Home layout, wires the services that later stages add, and hands
out a FastAPI application whose lifespan mirrors this object's start/dispose.
"""

from __future__ import annotations

import logging
import os

from megumi import __version__
from megumi.config import BackendConfig
from megumi.lifecycle import DisposeCallback, Lifecycle
from megumi.paths import HomePaths, ensure_home

logger = logging.getLogger(__name__)


class MegumiApp:
    """Owns backend resources for one process lifetime."""

    def __init__(self, config: BackendConfig, paths: HomePaths) -> None:
        self._config = config
        self._paths = paths
        self._lifecycle = Lifecycle()
        self._started = False

    @classmethod
    def from_config(cls, config: BackendConfig) -> MegumiApp:
        """Builds the object graph without touching the filesystem yet."""

        return cls(config, config.paths)

    @property
    def config(self) -> BackendConfig:
        return self._config

    @property
    def paths(self) -> HomePaths:
        return self._paths

    @property
    def started(self) -> bool:
        return self._started

    def start(self) -> None:
        """Creates the Home layout and acquires resources; raises on failure.

        Nothing is left half-acquired: if any step fails, everything registered so
        far is released before the error propagates.
        """

        if self._started:
            return
        try:
            ensure_home(self._paths)
        except BaseException:
            self._lifecycle.dispose()
            raise
        self._started = True
        logger.info(
            "backend.started",
            extra={
                "version": __version__,
                "home": str(self._paths.home),
                "pid": os.getpid(),
            },
        )

    def dispose(self) -> None:
        """Releases every acquired resource in reverse order."""

        if not self._started:
            self._lifecycle.dispose()
            return
        try:
            self._lifecycle.dispose()
        finally:
            self._started = False
            logger.info("backend.stopped", extra={"version": __version__})

    def register_resource(self, dispose: DisposeCallback) -> None:
        """Registers a cleanup callback for a resource acquired by a later stage."""

        self._lifecycle.on_dispose(dispose)
