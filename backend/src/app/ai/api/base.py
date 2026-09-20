"""Protocol collaborators receive prepared call snapshots and a shared runtime."""

from typing import Protocol

from app.ai.auth.types import ResolvedAuth
from app.ai.messages import Transcript
from app.ai.model import Model
from app.ai.options import CallOptions, SimpleOptions
from app.ai.runtime.clients import ClientRuntime
from app.ai.stream import ResponseWriter


class ProtocolAdapter(Protocol):
    """Encode requests and map native events; Models owns response production."""

    @property
    def options_type(self) -> type[CallOptions]:
        """The options class accepted by this protocol's explicit stream entry."""
        ...

    async def stream(
        self,
        *,
        model: Model,
        transcript: Transcript,
        options: CallOptions,
        auth: ResolvedAuth,
        clients: ClientRuntime,
        writer: ResponseWriter,
    ) -> None:
        """Produce events using explicit protocol options and shared HTTP execution."""
        ...

    async def stream_simple(
        self,
        *,
        model: Model,
        transcript: Transcript,
        options: SimpleOptions,
        auth: ResolvedAuth,
        clients: ClientRuntime,
        writer: ResponseWriter,
    ) -> None:
        """Map prepared simple preferences before producing protocol events."""
        ...
