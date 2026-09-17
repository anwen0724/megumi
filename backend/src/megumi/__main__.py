"""Entry point for ``python -m megumi``."""

from __future__ import annotations

import sys

from megumi.cli import main

if __name__ == "__main__":
    sys.exit(main())
