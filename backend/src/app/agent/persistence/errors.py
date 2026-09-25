"""Expose meaningful failures at the Agent persistence boundary."""


class StorageError(RuntimeError):
    """A persistence operation could not be completed."""


class NotFoundError(StorageError):
    """The requested saved record does not exist."""


class ConflictError(StorageError):
    """The requested write conflicts with committed facts."""


class BusyError(ConflictError):
    """The session still has an unreleased operation."""


class ArchivedError(ConflictError):
    """The session must be unarchived before accepting work."""


class InvalidRecordError(StorageError):
    """A record violates its type or ownership contract."""


class StaleWriteError(ConflictError):
    """The operation no longer matches the writer's expected state."""
