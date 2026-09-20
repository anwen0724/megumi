"""The environment an auth resolution reads from.

Providers resolve credentials from two places that are not the request: environment
variables, and the existence of a credential file that an SDK or CLI tool wrote. Both are
behind this context so a caller can substitute its own, which is what a test does and what
a non-Node host would need to.
"""

from __future__ import annotations

import os
from pathlib import Path

__all__ = ["EnvAuthContext", "default_provider_auth_context"]


class EnvAuthContext:
    """Reads environment variables from the process and checks files on disk.

    A blank variable counts as unset, because an empty value would otherwise be resolved as
    a credential and fail the request later.
    """

    async def env(self, name: str) -> str | None:
        """The value of ``name``, or ``None`` when it is unset or blank."""

        value = os.environ.get(name)
        if value is None or value.strip() == "":
            return None
        return value

    async def fileExists(self, path: str) -> bool:
        """Whether ``path`` exists, expanding a leading ``~`` to the home directory."""

        resolved = Path(path).expanduser() if path.startswith("~") else Path(path)
        try:
            resolved.stat()
        except OSError:
            return False
        return True


def default_provider_auth_context() -> EnvAuthContext:
    """The auth context a caller gets when it supplies none."""

    return EnvAuthContext()
