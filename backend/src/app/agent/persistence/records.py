"""Define typed durable records returned by Agent storage."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class SessionInfo:
    """Session management data, independent of a running operation."""

    id: str
    name: str | None
    created_at: int
    last_activity_at: int
    archived_at: int | None
