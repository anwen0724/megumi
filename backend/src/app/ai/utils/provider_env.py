"""Provider environment lookup, with a fallback for a sandbox with an empty environment.

Provider configuration arrives three ways, in decreasing precedence: values the caller
scoped to the request, the process environment, and — for a container whose process
environment is empty even though the kernel exposes one — ``/proc/self/environ``. An empty
value counts as unset so that a variable defined as an empty string does not shadow a real
value further down the chain.
"""

from __future__ import annotations

import os
from pathlib import Path

from app.ai.types import ProviderEnv

__all__ = ["getProviderEnvValue"]

_PROC_ENVIRON = Path("/proc/self/environ")
_proc_env_cache: dict[str, str] | None = None


def _get_sandbox_env_value(name: str) -> str | None:
    """Read ``name`` from ``/proc/self/environ`` when the process environment is empty.

    Some Linux sandboxes expose the environment only through the kernel, so a lookup that
    trusts the process environment alone reports every variable as unset.
    """

    global _proc_env_cache
    if os.environ:
        return None

    if _proc_env_cache is None:
        _proc_env_cache = {}
        try:
            data = _PROC_ENVIRON.read_bytes().decode("utf-8", errors="replace")
            for entry in data.split("\0"):
                index = entry.find("=")
                if index > 0:
                    _proc_env_cache[entry[:index]] = entry[index + 1 :]
        except OSError:
            # /proc/self/environ may not exist or may not be readable.
            pass

    return _proc_env_cache.get(name)


def getProviderEnvValue(name: str, env: ProviderEnv | None = None) -> str | None:
    """Resolve a provider environment value from the scoped, process and kernel sources."""

    return (
        (env or {}).get(name)
        or os.environ.get(name)
        or _get_sandbox_env_value(name)
        or None
    )
