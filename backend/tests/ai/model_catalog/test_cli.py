"""Command syntax errors fail before maintenance side effects."""

import pytest

from app.ai.scripts.model_catalog import main


@pytest.mark.parametrize(
    "args",
    [
        ["fetch", "--write"],
        ["check", "--write"],
        ["generate", "--unknown"],
        ["unknown"],
        ["fetch", "--provider", "../outside"],
        ["generate", "--provider", "unknown"],
    ],
)
def test_invalid_command_returns_two_and_has_no_side_effects(tool, args):
    assert main(args, tool=tool) == 2
    assert not tool.inputs.exists() and not tool.output.exists()
