"""Command entry for fetching, generating and checking provider model catalogs."""

import argparse
import sys

from app.ai.catalog_generation import CatalogError
from app.ai.catalog_generation.generate import CatalogTool, default_tool


def main(argv: list[str] | None = None, *, tool: CatalogTool | None = None) -> int:
    """Run one explicit maintenance operation and return its documented exit code."""
    parser = argparse.ArgumentParser(description="Maintain offline provider model catalogs")
    commands = parser.add_subparsers(dest="operation", required=True)
    for operation in ("fetch", "generate", "check"):
        command = commands.add_parser(operation)
        command.add_argument("--provider", action="append", dest="providers")
        if operation == "generate":
            command.add_argument("--write", action="store_true")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return int(exc.code or 0)
    try:
        active = tool if tool is not None else default_tool()
        if args.operation == "fetch":
            report = active.fetch(args.providers)
            status = 0
        else:
            status, report = active.generate(
                args.providers, write=getattr(args, "write", False), check=args.operation == "check"
            )
        for line in report:
            print(line)
        return status
    except (CatalogError, OSError, KeyError, TypeError, AttributeError) as exc:
        print(f"Catalog error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
