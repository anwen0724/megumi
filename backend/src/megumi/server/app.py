"""Defines the HTTP application surface of the backend.

Stage 1 exposes only the application object, its lifespan and a health check. The
operation routes, the request/response envelope and the event channel arrive with
the RPC stage; the error mapping below is already the one they will reuse.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from megumi import __version__
from megumi.app import MegumiApp
from megumi.errors import MegumiError

logger = logging.getLogger(__name__)

MEGUMI_APP_STATE_KEY = "megumi_app"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Ties the composition root's lifetime to the server's lifetime."""

    megumi: MegumiApp = getattr(app.state, MEGUMI_APP_STATE_KEY)
    megumi.start()
    try:
        yield
    finally:
        megumi.dispose()


def create_app(megumi: MegumiApp) -> FastAPI:
    """Builds the FastAPI application around an already-composed backend."""

    app = FastAPI(
        title="Megumi Backend",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    setattr(app.state, MEGUMI_APP_STATE_KEY, megumi)
    _register_error_handlers(app)
    _register_routes(app)
    return app


def get_megumi_app(request: Request) -> MegumiApp:
    """Dependency accessor for handlers; overridable in tests."""

    megumi: MegumiApp = getattr(request.app.state, MEGUMI_APP_STATE_KEY)
    return megumi


def _register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(MegumiError)
    async def handle_megumi_error(_: Request, error: MegumiError) -> JSONResponse:
        logger.warning("backend.error", extra={"code": error.code, "message": error.message})
        return JSONResponse(status_code=error.http_status, content={"ok": False, "error": error.to_dict()})


def _register_routes(app: FastAPI) -> None:
    @app.get("/health")
    async def health(request: Request) -> dict[str, object]:
        megumi = get_megumi_app(request)
        return {
            "status": "ok" if megumi.started else "starting",
            "version": __version__,
            "home": str(megumi.paths.home),
        }