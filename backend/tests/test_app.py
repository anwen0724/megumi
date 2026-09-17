"""Application object: startup effects, failure rollback and disposal order."""

from __future__ import annotations

import pytest

from megumi.app import MegumiApp
from megumi.errors import HomeUnavailableError


def test_from_config_builds_paths_without_creating_them(config_for) -> None:
    app = MegumiApp.from_config(config_for)

    assert app.paths.home == config_for.home
    assert not app.paths.home.exists()
    assert app.started is False


def test_start_creates_home_and_marks_the_app_started(config_for) -> None:
    app = MegumiApp.from_config(config_for)

    app.start()

    assert app.started is True
    assert app.paths.logs_dir.is_dir()
    assert app.paths.sqlite_dir.is_dir()


def test_start_is_idempotent(config_for) -> None:
    app = MegumiApp.from_config(config_for)

    app.start()
    app.start()

    assert app.started is True


def test_failed_start_releases_registered_resources(config_for) -> None:
    app = MegumiApp.from_config(config_for)
    released: list[str] = []
    app.register_resource(lambda: released.append("resource"))

    app.paths.home.parent.mkdir(parents=True, exist_ok=True)
    app.paths.home.write_text("blocked", encoding="utf-8")

    with pytest.raises(HomeUnavailableError):
        app.start()

    assert released == ["resource"]
    assert app.started is False


def test_dispose_releases_resources_in_reverse_order(config_for) -> None:
    app = MegumiApp.from_config(config_for)
    order: list[str] = []
    app.register_resource(lambda: order.append("first"))
    app.register_resource(lambda: order.append("second"))
    app.start()

    app.dispose()

    assert order == ["second", "first"]
    assert app.started is False


def test_dispose_without_start_is_safe(config_for) -> None:
    app = MegumiApp.from_config(config_for)

    app.dispose()

    assert app.started is False


def test_dispose_can_run_twice(config_for) -> None:
    app = MegumiApp.from_config(config_for)
    order: list[str] = []
    app.register_resource(lambda: order.append("once"))
    app.start()

    app.dispose()
    app.dispose()

    assert order == ["once"]


def test_existing_home_content_is_preserved(config_for) -> None:
    paths = config_for.paths
    paths.home.mkdir(parents=True)
    marker = paths.home / "user-file.txt"
    marker.write_text("keep me", encoding="utf-8")

    app = MegumiApp.from_config(config_for)
    app.start()

    assert marker.read_text(encoding="utf-8") == "keep me"
