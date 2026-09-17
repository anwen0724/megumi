"""Lifecycle stack: reverse-order release, single-run guarantee and failure reporting."""

from __future__ import annotations

import pytest

from megumi.lifecycle import Lifecycle


def test_callbacks_run_in_reverse_registration_order() -> None:
    calls: list[str] = []
    lifecycle = Lifecycle()

    lifecycle.on_dispose(lambda: calls.append("first"))
    lifecycle.on_dispose(lambda: calls.append("second"))
    lifecycle.dispose()

    assert calls == ["second", "first"]


def test_dispose_is_idempotent() -> None:
    calls: list[str] = []
    lifecycle = Lifecycle()
    lifecycle.on_dispose(lambda: calls.append("once"))

    lifecycle.dispose()
    lifecycle.dispose()

    assert calls == ["once"]
    assert lifecycle.disposed is True


def test_every_callback_runs_even_when_one_fails() -> None:
    calls: list[str] = []
    lifecycle = Lifecycle()
    lifecycle.on_dispose(lambda: calls.append("after"))
    lifecycle.on_dispose(_boom)
    lifecycle.on_dispose(lambda: calls.append("before"))

    with pytest.raises(RuntimeError) as error:
        lifecycle.dispose()

    assert calls == ["before", "after"]
    assert "1 cleanup callback(s) failed" in str(error.value)


def test_context_manager_disposes_on_exit() -> None:
    calls: list[str] = []

    with Lifecycle() as lifecycle:
        lifecycle.on_dispose(lambda: calls.append("closed"))

    assert calls == ["closed"]


def _boom() -> None:
    raise ValueError("cleanup failed")
