"""The User-Agent string sent with provider requests.

The reference builds its string from the host operating system and falls back to a bare
runtime marker where that information is unavailable, as in a browser build. The string is
part of the wire format providers see, so it is reproduced verbatim: both the product
token and the platform token keep the reference's spelling.
"""

from __future__ import annotations

import platform

__all__ = ["getPiUserAgent"]

# Node reports these platform identifiers, and the reference embeds them unchanged, so a
# system name has to be translated back to the identifier the reference would have used.
_NODE_PLATFORMS = {
    "windows": "win32",
    "linux": "linux",
    "darwin": "darwin",
    "java": "java",
    "freebsd": "freebsd",
    "openbsd": "openbsd",
    "sunos": "sunos",
    "aix": "aix",
}


def _node_platform() -> str:
    """The platform identifier the reference would report on this host."""

    system = platform.system()
    return _NODE_PLATFORMS.get(system.lower(), system.lower())


def getPiUserAgent() -> str:
    """Return the User-Agent value to send with provider requests."""

    node_platform = _node_platform()
    if not node_platform:
        return "pi (browser)"
    release = platform.release()
    return f"pi ({node_platform} {release}; {platform.machine()})"
