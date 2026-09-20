"""Defines the HTTP application: its lifespan and its routes."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import __version__


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Acquires resources when the server starts and releases them when it stops."""

    yield


def create_app() -> FastAPI:
    """Builds the HTTP application."""

    app = FastAPI(title="Megumi Backend", version=__version__, lifespan=lifespan)

    @app.get("/health")
    async def health() -> dict[str, str]:
        """Reports that the backend is up and which version is running."""

        return {"status": "ok", "version": __version__}

    return app