"""Home path resolution and directory creation."""

from __future__ import annotations

from pathlib import Path

import pytest

from megumi.errors import HomeUnavailableError
from megumi.paths import (
    MANAGED_DIRECTORY_NAMES,
    build_home_paths,
    ensure_home,
    resolve_home_path,
)


def test_explicit_home_overrides_the_default(tmp_path: Path) -> None:
    explicit = tmp_path / "explicit"

    resolved = resolve_home_path(str(explicit))

    assert resolved == explicit.resolve()
    assert resolved.is_absolute()


def test_relative_home_is_resolved_against_the_current_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)

    resolved = resolve_home_path("relative-home")

    assert resolved == (tmp_path / "relative-home").resolve()


def test_default_home_uses_the_given_user_directory(tmp_path: Path) -> None:
    resolved = resolve_home_path(None, home_directory=tmp_path)

    assert resolved == (tmp_path / ".megumi").resolve()


def test_blank_override_is_ignored() -> None:
    assert resolve_home_path("   ").name == ".megumi"


def test_layout_derives_every_path_from_the_root(tmp_path: Path) -> None:
    root = tmp_path / "home"

    paths = build_home_paths(root)

    assert paths.home == root.resolve()
    assert paths.sqlite_dir == paths.home / "sqlite"
    assert paths.logs_dir == paths.home / "logs"
    assert paths.cache_dir == paths.home / "cache"
    assert paths.tmp_dir == paths.home / "tmp"
    assert paths.attachments_dir == paths.home / "attachments"
    assert paths.settings_file == paths.home / "settings.json"
    assert paths.version_file == paths.home / "version.json"


def test_resolution_does_not_touch_the_filesystem(tmp_path: Path) -> None:
    missing = tmp_path / "not-created-yet"

    paths = build_home_paths(missing)

    assert not paths.home.exists()


def test_ensure_home_creates_every_managed_directory(config_for) -> None:
    paths = config_for.paths

    ensure_home(paths)

    assert paths.home.is_dir()
    for name in MANAGED_DIRECTORY_NAMES:
        assert (paths.home / name).is_dir()


def test_ensure_home_is_idempotent(config_for) -> None:
    paths = config_for.paths

    ensure_home(paths)
    ensure_home(paths)

    assert paths.home.is_dir()


def test_ensure_home_runs_on_an_existing_home_without_failing(config_for) -> None:
    paths = config_for.paths
    paths.home.mkdir(parents=True)
    (paths.home / "existing.txt").write_text("kept", encoding="utf-8")

    ensure_home(paths)

    assert (paths.home / "existing.txt").read_text(encoding="utf-8") == "kept"


def test_home_blocked_by_a_file_is_reported(config_for) -> None:
    paths = config_for.paths
    paths.home.parent.mkdir(parents=True, exist_ok=True)
    paths.home.write_text("this is a file, not a directory", encoding="utf-8")

    with pytest.raises(HomeUnavailableError) as error:
        ensure_home(paths)

    assert error.value.code == "home_unavailable"
    assert error.value.http_status == 503


def test_managed_directory_blocked_by_a_file_is_reported(config_for) -> None:
    paths = config_for.paths
    paths.home.mkdir(parents=True)
    paths.sqlite_dir.write_text("blocked", encoding="utf-8")

    with pytest.raises(HomeUnavailableError):
        ensure_home(paths)
