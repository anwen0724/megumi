"""Verify once-only usage facts, ordered queries and exact conservative totals."""

from decimal import Decimal
from uuid import uuid4

import pytest

from app.agent.persistence import SQLiteStore
from app.agent.persistence.errors import ConflictError
from app.ai import Usage, UsageCost


def test_usage_is_idempotent_ordered_and_survives_reopening(tmp_path):
    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session()
    operation = store.accept_operation(session.id, [])
    usage_id = str(uuid4())
    usage = Usage(
        input=3, output=5, reasoning=2, total_tokens=8, cost=UsageCost(total=Decimal("0.000000123"))
    )
    store.record_usage(usage_id, usage, session_id=session.id, operation_id=operation.id)
    store.record_usage(usage_id, usage, session_id=session.id, operation_id=operation.id)
    store.record_usage(
        str(uuid4()),
        Usage(
            input=7,
            output=11,
            reasoning=4,
            total_tokens=18,
            cost=UsageCost(total=Decimal("0.000000456")),
        ),
        session_id=session.id,
        adjustment=True,
    )
    store.close()
    store = SQLiteStore(path)
    rows = store.list_usage(session_id=session.id)
    assert [row.seq for row in rows] == [0, 1]
    totals = store.summarize_usage(session_id=session.id)
    assert totals.tokens.input == 10
    assert totals.tokens.output == 16
    assert totals.tokens.reasoning == 6
    assert totals.tokens.total_tokens == 26
    assert totals.tokens.cache_read is None
    assert totals.costs["USD"].total == Decimal("0.000000579")
    with pytest.raises(ConflictError):
        store.record_usage(
            usage_id, Usage(input=99), session_id=session.id, operation_id=operation.id
        )
    store.close()


def test_unknown_components_and_currencies_are_not_combined(tmp_path):
    store = SQLiteStore(tmp_path / "agent.sqlite3")
    session = store.create_session()
    for usage in [
        Usage(input=2, cost=UsageCost(currency="USD", total=Decimal("0.1"))),
        Usage(input=None, cost=UsageCost(currency="CNY", total=Decimal("0.7"))),
    ]:
        store.record_usage(str(uuid4()), usage, session_id=session.id)
    summary = store.summarize_usage(session_id=session.id)
    assert summary.tokens.input is None
    assert summary.costs["USD"].total == Decimal("0.1")
    assert summary.costs["CNY"].total == Decimal("0.7")
    store.record_usage(str(uuid4()), Usage(input=1), session_id=session.id)
    summary = store.summarize_usage(session_id=session.id)
    assert summary.has_unknown_cost
    assert summary.costs["USD"].total is None
    assert [row.seq for row in store.list_usage(session_id=session.id, after_seq=0)] == [1, 2]
    store.close()
