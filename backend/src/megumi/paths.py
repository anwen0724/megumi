"""Resolves the Megumi Home directory and its stable subdirectory layout.

Home is where all backend-owned local data lives: settings, the SQLite database,
logs, attachments and temporary files. Path resolution is kept separate from
directory creation so it can be used and tested without touching the filesystem.
"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from megumi.errors import HomeUnavailableError

DEFAULT_HOME_DIRECTORY_NAME = ".megumi"

# Directories created under Home during startup.
MANAGED_DIRECTORY_NAMES = ("sqlite", "logs", "cache", "tmp", "attachments")


@dataclass(frozen=True, slots=True)
class HomePaths:
    """The stable Home layout; every path is derived from one resolved root."""

    home: Path
    sqlite_dir: Path
    logs_dir: Path
    cache_dir: Path
    tmp_dir: Path
    attachments_dir: Path
    settings_file: Path
    readme_file: Path
    version_file: Path

    @property
    def managed_directories(self) -> tuple[Path, ...]:
        return (
            self.sqlite_dir,
            self.logs_dir,
            self.cache_dir,
            self.tmp_dir,
            self.attachments_dir,
        )


def resolve_home_path(override: str | None, home_directory: Path | None = None) -> Path:
    """Resolves the Home root: an explicit ``MEGUMI_HOME`` wins over the default.

    The default is ``<user home>/.megumi``. Resolution never touches the
    filesystem, so a path pointing at a missing directory is still valid here.
    """

    configured = (override or "").strip()
    if configured:
        return Path(configured).expanduser().resolve(strict=False)
    base = home_directory if home_directory is not None else Path.home()
    return (base / DEFAULT_HOME_DIRECTORY_NAME).resolve(strict=False)


def build_home_paths(home: Path) -> HomePaths:
    """Builds every Home path from one already-resolved root."""

    root = home.resolve(strict=False)
    return HomePaths(
        home=root,
        sqlite_dir=root / "sqlite",
        logs_dir=root / "logs",
        cache_dir=root / "cache",
        tmp_dir=root / "tmp",
        attachments_dir=root / "attachments",
        settings_file=root / "settings.json",
        readme_file=root / "README.md",
        version_file=root / "version.json",
    )


def ensure_home(paths: HomePaths) -> None:
    """Creates the Home layout if needed and fails loudly when it is not writable."""

    try:
        for directory in (paths.home, *paths.managed_directories):
            directory.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise HomeUnavailableError(
            f"Megumi Home could not be created at {paths.home}.",
            details={"path": str(paths.home), "reason": error.strerror or str(error)},
            cause=error,
        ) from error

    for directory in (paths.home, *paths.managed_directories):
        if not directory.is_dir():
            raise HomeUnavailableError(
                f"Megumi Home path is not a directory: {directory}.",
                details={"path": str(directory)},
            )

    _verify_writable(paths.home)


def _verify_writable(directory: Path) -> None:
    """Proves writability with a real temporary file instead of an access check."""

    try:
        with tempfile.NamedTemporaryFile(dir=directory, prefix=".write-probe-", delete=True):
            pass
    except OSError as error:
        raise HomeUnavailableError(
            f"Megumi Home is not writable: {directory}.",
            details={
                "path": str(directory),
                "reason": getattr(error, "strerror", None) or str(error),
                "pid": os.getpid(),
            },
            cause=error,
        ) from error
