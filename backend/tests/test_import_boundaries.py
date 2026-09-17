"""Dependency direction and file hygiene rules the backend must keep.

The backend is layered. ``core``-level modules (errors, paths) must stay usable
by everything and must not reach upward; only the composition root and the server
may depend on the application object. These tests fail loudly when that rule is
broken, which is the Python equivalent of the source guards used elsewhere in the
repository.
"""

from __future__ import annotations

import ast
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src" / "megumi"

# Modules each module is allowed to import from inside the package.
ALLOWED_INTERNAL_IMPORTS: dict[str, set[str]] = {
    "__init__": set(),
    "__main__": {"cli"},
    "errors": set(),
    "paths": {"errors"},
    "config": {"errors", "paths"},
    "lifecycle": set(),
    "logging_setup": {"config"},
    "app": {"config", "errors", "lifecycle", "paths"},
    "cli": {"app", "config", "errors", "logging_setup", "server.main"},
    "server": set(),
    "server.app": {"app", "errors"},
    "server.main": {"app", "errors", "server.app"},
}

KNOWN_MODULES = set(ALLOWED_INTERNAL_IMPORTS)


def test_every_source_module_is_declared() -> None:
    discovered = {_module_name(path) for path in _source_files()}

    assert discovered == KNOWN_MODULES


def test_modules_only_import_allowed_dependencies() -> None:
    violations: list[str] = []
    for path in _source_files():
        module = _module_name(path)
        allowed = ALLOWED_INTERNAL_IMPORTS[module]
        for imported in _internal_imports(path):
            if imported not in allowed:
                violations.append(f"{path.name}: '{module}' imports '{imported}'")

    assert violations == []


def test_every_source_file_has_a_module_docstring() -> None:
    missing = [
        path.name
        for path in _source_files()
        if ast.get_docstring(ast.parse(path.read_text(encoding="utf-8"))) is None
    ]

    assert missing == []


def _source_files() -> list[Path]:
    return sorted(path for path in SOURCE_ROOT.rglob("*.py") if "__pycache__" not in path.parts)


def _module_name(path: Path) -> str:
    relative = path.relative_to(SOURCE_ROOT).with_suffix("")
    parts = list(relative.parts)
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts) if parts else "__init__"


def _internal_imports(path: Path) -> set[str]:
    """Collects internal modules imported by one file, ignoring the package root.

    ``from megumi import __version__`` imports the package root itself, which is
    not a module in the layering table and therefore never a violation.
    """

    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and _is_internal(node.module):
            found.add(_strip_package_prefix(node.module))
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if _is_internal(alias.name):
                    found.add(_strip_package_prefix(alias.name))
    found.discard("")
    found.discard("__init__")
    return found


def _is_internal(name: str) -> bool:
    return name == "megumi" or name.startswith("megumi.")


def _strip_package_prefix(name: str) -> str:
    if name == "megumi":
        return ""
    return name.removeprefix("megumi.")
