"""HTTP surface: health response, error envelope and dependency override support."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from megumi import __version__
from megumi.app import MegumiApp
from megumi.errors import ServerStartupError
from megumi.server.app import create_app, get_megumi_app


@pytest.fixture
def megumi_app(config_for) -> MegumiApp:
    return MegumiApp.from_config(config_for)


@pytest.fixture
def client(megumi_app: MegumiApp) -> Iterator[TestClient]:
    with TestClient(create_app(megumi_app)) as test_client:
        yield test_client


def test_health_reports_status_version_and_home(client: TestClient, megumi_app: MegumiApp) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == __version__
    assert body["home"] == str(megumi_app.paths.home)


def test_lifespan_starts_and_disposes_the_application(megumi_app: MegumiApp) -> None:
    with TestClient(create_app(megumi_app)) as test_client:
        assert megumi_app.started is True
        test_client.get("/health")

    assert megumi_app.started is False


def test_startup_failure_is_not_reported_as_success(config_for) -> None:
    config_for.paths.home.parent.mkdir(parents=True, exist_ok=True)
    config_for.paths.home.write_text("blocked", encoding="utf-8")
    app = create_app(MegumiApp.from_config(config_for))

    with pytest.raises(Exception, match="Megumi Home"), TestClient(app):
        pass


def test_megumi_error_is_rendered_as_json_envelope(client: TestClient) -> None:
    app: FastAPI = client.app  # type: ignore[assignment]

    @app.get("/boom")
    async def boom() -> None:
        raise ServerStartupError("no socket", details={"port": 0})

    response = client.get("/boom")

    assert response.status_code == 500
    assert response.json() == {
        "ok": False,
        "error": {
            "code": "server_startup_failed",
            "message": "no socket",
            "details": {"port": 0},
        },
    }


def test_dependencies_can_be_overridden_in_tests(megumi_app: MegumiApp, config_for) -> None:
    replacement = MegumiApp.from_config(config_for)
    app = create_app(megumi_app)
    app.dependency_overrides[get_megumi_app] = lambda: replacement

    @app.get("/who")
    async def who(request: Request) -> dict[str, str]:
        return {"home": str(get_megumi_app(request).paths.home)}

    with TestClient(app) as test_client:
        assert test_client.get("/who").json() == {"home": str(replacement.paths.home)}


def test_unknown_route_returns_404(client: TestClient) -> None:
    assert client.get("/not-a-route").status_code == 404
