"""Resolves the HTTP proxy for a target URL from the environment.

The rules are the ones a proxy-aware HTTP client follows: a protocol-specific variable wins
over an all-protocol one, a bare ``host:port`` value is taken to mean the target's own
scheme, and ``no_proxy`` can excuse a host entirely. ``no_proxy`` is matched entry by
entry, and an entry that names a different port does not excuse the host, which is the
detail that decides whether a request bypasses the proxy or not.
"""

from __future__ import annotations

import re
from typing import NamedTuple
from urllib.parse import urlsplit

from app.ai.types import ProviderEnv
from app.ai.utils.provider_env import getProviderEnvValue

__all__ = [
    "DEFAULT_PROXY_PORTS",
    "UNSUPPORTED_PROXY_PROTOCOL_MESSAGE",
    "ProxyTarget",
    "getProxyEnv",
    "getProxyForUrl",
    "parseNoProxyEntry",
    "parseProxyTargetUrl",
    "resolveHttpProxyUrlForTarget",
    "shouldProxyHostname",
]

DEFAULT_PROXY_PORTS: dict[str, int] = {
    "ftp": 21,
    "gopher": 70,
    "http": 80,
    "https": 443,
    "ws": 80,
    "wss": 443,
}

UNSUPPORTED_PROXY_PROTOCOL_MESSAGE = (
    "Unsupported proxy protocol. SOCKS and PAC proxy URLs are not supported; "
    "use an HTTP or HTTPS proxy URL."
)

_NO_PROXY_SEPARATORS = re.compile(r"[,\s]")

# The scheme a proxy variable is named for, without its trailing colon.
_SCHEME_PREFIX = re.compile(r"^([^:]+):")


class ProxyTarget(NamedTuple):
    """The parts of a target URL that the proxy decision needs."""

    protocol: str
    hostname: str
    port: int


def getProxyEnv(key: str, env: ProviderEnv | None = None) -> str:
    """Read a proxy variable in either case, from the scoped and process environments."""

    scoped = env or {}
    lowercase_key = key.lower()
    uppercase_key = key.upper()
    return (
        scoped.get(lowercase_key)
        or scoped.get(uppercase_key)
        or getProviderEnvValue(lowercase_key)
        or getProviderEnvValue(uppercase_key)
        or ""
    )


def _port_or_none(port: int | None) -> int:
    """A parsed port, or zero when the URL named none."""

    return port if port else 0


def parseProxyTargetUrl(target_url: str | ProxyTarget) -> ProxyTarget | None:
    """Parse a target URL, or ``None`` when it has no scheme or no host."""

    if isinstance(target_url, ProxyTarget):
        return target_url

    parts = urlsplit(target_url)
    scheme = parts.scheme
    hostname = parts.hostname
    if not scheme or not hostname:
        return None

    protocol = _SCHEME_PREFIX.sub(r"\1", f"{scheme}:")
    port = _port_or_none(parts.port) or DEFAULT_PROXY_PORTS.get(protocol, 0)
    return ProxyTarget(protocol=protocol, hostname=hostname, port=port)


def _strip_brackets(host: str) -> str:
    """Remove the brackets an IPv6 literal host is written with."""

    if host.startswith("[") and host.endswith("]"):
        return host[1:-1]
    return host


def _parse_port_or_zero(text: str) -> int:
    """Parse a port, treating anything that is not a number as zero."""

    try:
        return int(text, 10)
    except ValueError:
        return 0


def parseNoProxyEntry(entry: str) -> tuple[str, int] | None:
    """Parse one ``no_proxy`` entry into a host and the port it is scoped to.

    A port of zero means "any port".
    """

    trimmed = entry.strip().lower()
    if not trimmed:
        return None

    if trimmed.startswith("["):
        closing_bracket = trimmed.find("]")
        if closing_bracket != -1:
            host = trimmed[1:closing_bracket]
            rest = trimmed[closing_bracket + 1 :]
            if rest.startswith(":"):
                return host, _parse_port_or_zero(rest[1:])
            return host, 0

    if ":" in trimmed and len(trimmed.split(":")) > 2:
        # A bare IPv6 address has several colons and carries no port.
        return trimmed, 0

    colon_index = trimmed.rfind(":")
    if colon_index != -1 and colon_index == trimmed.find(":"):
        host = trimmed[:colon_index]
        port = _parse_port_or_zero(trimmed[colon_index + 1 :])
        if port:
            return host, port

    return trimmed, 0


def shouldProxyHostname(hostname: str, port: int, env: ProviderEnv | None = None) -> bool:
    """Whether a request to ``hostname`` at ``port`` should go through the proxy.

    Every ``no_proxy`` entry has to excuse the target, so one entry that does not match
    leaves the request proxied.
    """

    no_proxy = getProxyEnv("no_proxy", env).lower()
    if not no_proxy:
        return True
    if no_proxy == "*":
        return False

    normalized_target_host = _strip_brackets(hostname.lower())

    for entry in _NO_PROXY_SEPARATORS.split(no_proxy):
        parsed = parseNoProxyEntry(entry)
        if parsed is None:
            continue
        entry_host, entry_port = parsed

        if entry_port and entry_port != port:
            continue

        domain = _strip_brackets(entry_host)
        if domain.startswith("*."):
            domain = domain[2:]
        elif domain.startswith(".") or domain.startswith("*"):
            domain = domain[1:]

        if not domain:
            continue

        if normalized_target_host == domain:
            return False
        if normalized_target_host.endswith(f".{domain}"):
            return False

    return True


def getProxyForUrl(target_url: str | ProxyTarget, env: ProviderEnv | None = None) -> str:
    """The proxy that applies to ``target_url``, or an empty string when none does."""

    parsed = parseProxyTargetUrl(target_url)
    if parsed is None:
        return ""

    if not shouldProxyHostname(parsed.hostname, parsed.port, env):
        return ""

    proxy = getProxyEnv(f"{parsed.protocol}_proxy", env) or getProxyEnv("all_proxy", env)
    if proxy and "://" not in proxy:
        proxy = f"{parsed.protocol}://{proxy}"
    return proxy


def resolveHttpProxyUrlForTarget(
    target_url: str | ProxyTarget,
    env: ProviderEnv | None = None,
) -> str | None:
    """The proxy URL to use for ``target_url``, or ``None`` when it should be direct.

    Fails when the configured proxy is not usable, rather than quietly sending the request
    straight to the target the caller asked to route through a proxy.
    """

    proxy = getProxyForUrl(target_url, env)
    if not proxy:
        return None

    parsed = urlsplit(proxy)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError(f"Invalid proxy URL {proxy!r}")

    scheme = f"{parsed.scheme}:"
    if scheme not in ("http:", "https:"):
        raise ValueError(f"{UNSUPPORTED_PROXY_PROTOCOL_MESSAGE} Got {scheme}")

    return proxy
