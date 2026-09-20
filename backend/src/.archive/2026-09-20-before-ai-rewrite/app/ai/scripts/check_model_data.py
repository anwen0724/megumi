"""Build-time check that the generated model catalogue is present and current.

The catalogue is a build artefact rather than source, so a checkout can have a missing or
stale one after a schema change. This check fails the build in that case, with the command
that regenerates it, instead of letting a request fail later against wrong model metadata.
"""

from __future__ import annotations

import sys
from pathlib import Path

from app.ai.scripts.model_data import validateGeneratedModelData

__all__ = ["main"]

# Where the check expects to find the package it validates, relative to this file.
PACKAGE_ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    """Validate the generated catalogue, reporting what to do when it is unusable."""

    try:
        validateGeneratedModelData(PACKAGE_ROOT)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        print(
            "\nModel data is missing or stale. "
            "Run `python scripts/generate_models.py --strict` to regenerate it.",
            file=sys.stderr,
        )
        return 1
    print("Generated model data is valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
