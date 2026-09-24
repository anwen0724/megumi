"""Call option preparation preserves data isolation and resource identity."""

import asyncio
from dataclasses import replace

from app.ai.api.simple_options import prepare_simple_options
from app.ai.messages import Transcript
from app.ai.model import ModelCapabilities
from app.ai.options import SimpleOptions


def test_simple_merges_defaults_clamps_and_preserves_control_identity(provider, monkeypatch):
    monkeypatch.setenv("MEGUMI_AI_CACHE_RETENTION", "long")
    model = replace(
        provider.get_models()[0],
        context_window=10000,
        max_output_tokens=8000,
        sampling_params={"top_p": 0.8, "x": 1},
        capabilities=ModelCapabilities(reasoning=True, reasoning_levels={"low": None}),
    )
    signal = asyncio.Event()

    def callback(payload, model):
        return None

    options = SimpleOptions(
        reasoning="low",
        sampling_params={"x": 2},
        signal=signal,
        tool_choice="none",
        on_payload=callback,
        env={"MEGUMI_AI_CACHE_RETENTION": None},
    )
    prepared = prepare_simple_options(model, Transcript(messages=[]), options)
    assert (prepared.reasoning, prepared.max_output_tokens, prepared.cache_retention) == (
        "medium",
        5904,
        "short",
    )
    assert prepared.sampling_params == {"top_p": 0.8, "x": 2}
    assert prepared.tool_choice == "none"
    assert prepared.signal is signal and prepared.on_payload is callback
    prepared.sampling_params["x"] = 3
    assert options.sampling_params == {"x": 2}
    assert (
        prepare_simple_options(model, Transcript(messages=[]), SimpleOptions()).cache_retention
        == "long"
    )
    assert (
        prepare_simple_options(
            model, Transcript(messages=[]), SimpleOptions(cache_retention="none")
        ).cache_retention
        == "none"
    )
