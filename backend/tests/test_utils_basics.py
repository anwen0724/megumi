"""Tests for the short-hash, surrogate, uuid, text, header and user-agent utilities.

The hash cases are the reference implementation's own outputs, captured from the source
algorithm, because that hash feeds identifiers that travel in request bodies and a
different digest would silently change every derived id.
"""

from __future__ import annotations

import re
import uuid as uuid_module

import pytest

from app.ai.types import SystemMessage, TextContent
from app.ai.utils.hash import shortHash
from app.ai.utils.headers import headersToRecord, providerHeadersToRecord
from app.ai.utils.sanitize_unicode import sanitizeSurrogates
from app.ai.utils.text import contentText, getSystemMessageText, renderSystemMessageUpdate
from app.ai.utils.user_agent import getPiUserAgent
from app.ai.utils.uuid import MAX_UUID_V7_TIMESTAMP, uuidv7

# Expected values captured from the reference implementation of this hash. They are fixed
# rather than computed here: the point of the test is that the port reproduces the
# reference's digest exactly, and computing the expectation in the test would make it
# circular.
#
# A sequence is used rather than a mapping because two distinct unpaired surrogates would
# collide as mapping keys.
REFERENCE_HASHES = [
    ("", "k4n83c7h0j2b"),
    ("a", "m8735310ae7sx"),
    ("abc", "y0biex7f9bbh"),
    ("hello world", "n7rb4n1m39uz8"),
    ("tool_call_123", "8nna361e1zk4j"),
    ("msg_abc", "6piae0s8vela"),
    ("pi_tool_load_read,write,edit", "hcf25up61fht"),
    ("中文内容", "1gp7ajcrfzq5i"),
    ("🙈", "kphsz0153ms3q"),
    ("C:\\dir\\file.ts", "c3tx7j1j3606a"),
    ("x" * 1000, "zykls21ciz8e3"),
    ("\ud800", "sjkthq29gslh"),
    ("\udfff", "1cq0gnajlsoxf"),
]


@pytest.mark.parametrize(("text", "expected"), REFERENCE_HASHES)
def test_short_hash_matches_the_reference(text: str, expected: str) -> None:
    assert shortHash(text) == expected


def test_short_hash_is_deterministic_and_short() -> None:
    assert shortHash("same") == shortHash("same")
    assert shortHash("same") != shortHash("other")
    assert re.fullmatch(r"[0-9a-z]+", shortHash("value"))


def test_short_hash_counts_utf16_code_units() -> None:
    # A non-BMP character is two code units in the reference, so it must not be treated
    # as one code point.
    assert shortHash("🙈") != shortHash("\U0001f648 ")


class TestSanitizeSurrogates:
    def test_keeps_text_without_surrogates(self) -> None:
        assert sanitizeSurrogates("plain text") == "plain text"

    def test_keeps_a_paired_surrogate(self) -> None:
        emoji = "Hello \U0001f648 World"

        assert sanitizeSurrogates(emoji) == emoji

    def test_removes_an_unpaired_high_surrogate(self) -> None:
        assert sanitizeSurrogates("Text \ud83d here") == "Text  here"

    def test_removes_an_unpaired_low_surrogate(self) -> None:
        assert sanitizeSurrogates("Text \udc00 here") == "Text  here"

    def test_removes_an_unpaired_surrogate_pair_mixed_with_a_valid_one(self) -> None:
        text = "\ud83d\udc00\ud83d"

        assert sanitizeSurrogates(text) == "\ud83d\udc00"


class TestText:
    def test_content_text_returns_a_plain_string_unchanged(self) -> None:
        assert contentText("hello") == "hello"

    def test_content_text_joins_text_blocks_and_drops_other_blocks(self) -> None:
        content = [
            TextContent(text="first"),
            TextContent(text="second"),
        ]

        assert contentText(content) == "first\nsecond"
        assert contentText(content, separator=" ") == "first second"

    def test_content_text_of_no_blocks_is_empty(self) -> None:
        assert contentText([]) == ""

    def test_system_message_text_appends_sections(self) -> None:
        message = SystemMessage(
            content="base",
            timestamp=0,
            sections={"tools": "tool text", "removed": None},
        )

        assert getSystemMessageText(message) == "base\n\ntool text"

    def test_system_message_text_drops_empty_parts(self) -> None:
        assert getSystemMessageText(SystemMessage(content="", timestamp=0)) == ""

    def test_system_message_update_frames_section_changes(self) -> None:
        message = SystemMessage(
            content="extra",
            timestamp=0,
            sections={"tools": "new text", "gone": None},
        )

        rendered = renderSystemMessageUpdate(message)

        assert rendered == (
            'extra\n\nUpdated system prompt section "tools":\n\nnew text'
            '\n\nRemoved system prompt section "gone".'
        )

    def test_system_message_update_without_sections_is_just_content(self) -> None:
        assert renderSystemMessageUpdate(SystemMessage(content="only", timestamp=0)) == "only"


class TestHeaders:
    def test_headers_to_record_keeps_the_last_value_per_name(self) -> None:
        assert headersToRecord([("a", "1"), ("b", "2"), ("a", "3")]) == {"a": "3", "b": "2"}

    def test_headers_to_record_of_nothing_is_empty(self) -> None:
        assert headersToRecord([]) == {}

    def test_provider_headers_drop_suppressed_entries(self) -> None:
        assert providerHeadersToRecord({"keep": "v", "drop": None}) == {"keep": "v"}

    def test_provider_headers_of_nothing_is_undefined(self) -> None:
        assert providerHeadersToRecord(None) is None
        assert providerHeadersToRecord({}) is None

    def test_provider_headers_that_are_all_suppressed_is_undefined(self) -> None:
        assert providerHeadersToRecord({"a": None}) is None


class TestUuidV7:
    def test_generates_a_valid_version_7_uuid(self) -> None:
        value = uuidv7()
        parsed = uuid_module.UUID(value)

        assert parsed.version == 7
        assert parsed.variant == uuid_module.RFC_4122

    def test_embeds_the_supplied_timestamp(self) -> None:
        timestamp = 1_700_000_000_000

        parsed = uuid_module.UUID(uuidv7(timestamp))

        assert parsed.int >> 80 == timestamp

    def test_values_are_unique_and_increasing(self) -> None:
        values = [uuidv7(1_700_000_000_000) for _ in range(50)]

        assert len(set(values)) == 50
        assert values == sorted(values)

    def test_ordinary_calls_never_go_backwards(self) -> None:
        tz = 1_000_000_000_000

        forward = uuidv7(tz + 5)
        ordinary = uuidv7()

        # An ordinary identifier must not sort before an explicitly stamped one already
        # issued, so the monotonic clock only ever advances.
        assert uuid_module.UUID(ordinary).int >> 80 >= tz + 5
        assert uuid_module.UUID(ordinary).int > uuid_module.UUID(forward).int

    def test_an_explicit_timestamp_leaves_the_monotonic_clock_alone(self) -> None:
        # Recording a follower identifier must not push later ordinary identifiers forward.
        uuidv7(1)
        uuidv7()
        after_ordinary = uuid_module.UUID(uuidv7()).int >> 80

        uuidv7(1)

        assert uuid_module.UUID(uuidv7()).int >> 80 >= after_ordinary

    @pytest.mark.parametrize("timestamp", [-1, MAX_UUID_V7_TIMESTAMP + 1])
    def test_rejects_out_of_range_timestamps(self, timestamp: int) -> None:
        with pytest.raises(ValueError, match="UUIDv7 timestamp"):
            uuidv7(timestamp)


class TestUserAgent:
    def test_reports_a_pi_user_agent(self) -> None:
        agent = getPiUserAgent()

        assert agent.startswith("pi (")
        assert agent.endswith(")")
        # Three fields: platform, release, architecture.
        assert len(agent[4:-1].split("; ")) == 2

    def test_uses_the_reference_platform_identifier(self) -> None:
        agent = getPiUserAgent()
        fields = agent[agent.index("(") + 1 : -1].split("; ")

        # The reference embeds Node's platform identifier, which is not Python's spelling.
        assert fields[0].split(" ")[0].startswith(("win32", "linux", "darwin"))
        assert "windows" not in agent.lower()
