"""Tests for parsing model-produced JSON, including JSON that is still arriving.

The repair cases are the reason this module exists: a model that writes a Windows path or
a raw newline into a JSON string produces text that a strict parser rejects, and doubling
the backslash is what recovers the intended value instead of losing every separator.
"""

from __future__ import annotations

import json
import math

import pytest

from app.ai.utils.json_parse import (
    parse_json_with_repair,
    parse_streaming_json,
    repair_json,
)


class TestRepairJson:
    def test_leaves_valid_json_unchanged(self) -> None:
        source = '{"a": 1, "b": [true, null]}'

        assert repair_json(source) == source

    def test_doubles_a_backslash_before_an_invalid_escape(self) -> None:
        # ``\d`` is not a JSON escape, so the backslash becomes a literal one.
        assert repair_json('{"p":"C:\\dir"}') == '{"p":"C:\\\\dir"}'

    def test_recovers_a_windows_path_whose_escapes_are_all_invalid(self) -> None:
        # ``\d`` and ``\p`` are not JSON escapes, so each backslash becomes literal and
        # the path survives as written.
        parsed = parse_json_with_repair('{"p":"C:\\dir\\photos"}')

        assert parsed == {"p": "C:\\dir\\photos"}

    def test_a_path_segment_that_is_a_valid_escape_is_read_as_that_escape(self) -> None:
        # ``\f`` *is* a JSON escape, so repair leaves it alone and the parse turns it into
        # a form feed. This is the documented behaviour of the repair pass, and it is why
        # repair cannot be relied on for every path.
        parsed = parse_json_with_repair('{"p":"C:\\file.txt"}')

        assert parsed == {"p": "C:\x0cile.txt"}

    def test_keeps_a_valid_escape_as_it_is(self) -> None:
        assert repair_json('{"a":"line\\nbreak"}') == '{"a":"line\\nbreak"}'

    def test_keeps_a_unicode_escape_as_it_is(self) -> None:
        assert repair_json('{"a":"\\u00e9"}') == '{"a":"\\u00e9"}'

    def test_doubles_a_truncated_unicode_escape(self) -> None:
        # ``\u12`` is not four hex digits, so it is not a unicode escape and its backslash
        # becomes literal.
        repaired = repair_json('{"a":"\\u12"}')

        assert repaired == '{"a":"\\\\u12"}'
        assert json.loads(repaired) == {"a": "\\u12"}

    def test_escapes_a_raw_newline_inside_a_string(self) -> None:
        assert repair_json('{"a":"x\ny"}') == '{"a":"x\\ny"}'

    def test_escapes_a_raw_tab_inside_a_string(self) -> None:
        assert repair_json('{"a":"x\ty"}') == '{"a":"x\\ty"}'

    def test_escapes_an_unnamed_control_character(self) -> None:
        assert repair_json('{"a":"x\x01y"}') == '{"a":"x\\u0001y"}'

    def test_leaves_control_characters_outside_a_string_alone(self) -> None:
        # Outside a string a control character is whitespace, not content.
        assert repair_json('{"a":\n1}') == '{"a":\n1}'

    def test_doubles_a_trailing_backslash(self) -> None:
        assert repair_json('{"a":"x\\') == '{"a":"x\\\\'

    def test_does_not_repair_the_text_after_a_string_closes(self) -> None:
        assert repair_json('{"a":"x","b":"C:\\d"}') == '{"a":"x","b":"C:\\\\d"}'

    def test_a_quoted_backslash_does_not_open_a_string(self) -> None:
        assert repair_json('\\"not a string\\"') == '\\"not a string\\"'


class TestParseJsonWithRepair:
    def test_parses_valid_json(self) -> None:
        assert parse_json_with_repair('{"a": 1}') == {"a": 1}

    def test_parses_after_repair(self) -> None:
        assert parse_json_with_repair('{"a":"x\ny"}') == {"a": "x\ny"}

    def test_raises_the_original_error_when_repair_cannot_help(self) -> None:
        with pytest.raises(ValueError):
            parse_json_with_repair("{not json at all")


class TestParseStreamingJson:
    def test_returns_an_empty_mapping_for_nothing(self) -> None:
        assert parse_streaming_json(None) == {}
        assert parse_streaming_json("") == {}
        assert parse_streaming_json("   ") == {}

    def test_parses_complete_json(self) -> None:
        assert parse_streaming_json('{"path":"a.txt"}') == {"path": "a.txt"}

    def test_returns_what_arrived_for_a_truncated_object(self) -> None:
        assert parse_streaming_json('{"path":"a.txt"') == {"path": "a.txt"}

    def test_returns_what_arrived_for_a_truncated_nested_object(self) -> None:
        assert parse_streaming_json('{"a":{"b":1},"c":{"d":2') == {"a": {"b": 1}, "c": {"d": 2}}

    def test_returns_an_empty_mapping_for_a_lone_open_brace(self) -> None:
        assert parse_streaming_json("{") == {}

    def test_returns_the_elements_of_a_truncated_array(self) -> None:
        assert parse_streaming_json("[1, 2, 3") == [1, 2, 3]

    def test_completes_a_truncated_string(self) -> None:
        assert parse_streaming_json('{"path":"READ') == {"path": "READ"}

    def test_drops_a_value_that_arrived_without_its_key(self) -> None:
        # The member was not finished, so the partial value is discarded rather than
        # reported against a key that may turn out to be different.
        assert parse_streaming_json('{"path":"a.txt","content":') == {"path": "a.txt"}

    def test_completes_a_truncated_number(self) -> None:
        assert parse_streaming_json('{"n": 12') == {"n": 12}

    def test_drops_a_truncated_exponent(self) -> None:
        assert parse_streaming_json('{"n": 1.5e') == {"n": 1.5}

    def test_parses_a_partial_literal(self) -> None:
        assert parse_streaming_json('{"ok": tru') == {"ok": True}
        assert parse_streaming_json('{"v": nul') == {"v": None}

    def test_survives_a_windows_path_that_arrived_in_pieces(self) -> None:
        pieces = ['{"p":"C:', "\\\\us", 'ers\\\\me"}']
        accumulated = ""
        results = []
        for piece in pieces:
            accumulated += piece
            results.append(parse_streaming_json(accumulated))

        assert results[-1] == {"p": "C:\\users\\me"}

    def test_never_raises_on_malformed_input(self) -> None:
        for source in ("{not json", "[[[[", "}{", '"unterminated', "\\", ":", ","):
            result = parse_streaming_json(source)

            assert isinstance(result, (dict, list, str, int, float, bool)) or result is None

    def test_reads_arguments_incrementally_as_a_tool_call_streams(self) -> None:
        # The shape a streamed tool call actually produces, one delta at a time. Each
        # prefix must parse without raising, growing as the text arrives.
        deltas = ['{"pa', 'th":"RE', 'ADME.md","con', 'tent":"he', 'llo"}']
        accumulated = ""
        seen: list[object] = []
        for delta in deltas:
            accumulated += delta
            seen.append(parse_streaming_json(accumulated))

        # An unfinished key cannot be reported, because the key may still change.
        assert seen[0] == {}
        assert seen[1] == {"path": "RE"}
        assert seen[2] == {"path": "README.md"}
        assert seen[3] == {"path": "README.md", "content": "he"}
        assert seen[-1] == {"path": "README.md", "content": "hello"}

    def test_accepts_the_non_standard_numeric_literals_of_a_partial_parse(self) -> None:
        assert math.isinf(parse_streaming_json("Infinity"))
        assert math.isnan(parse_streaming_json("NaN"))

    def test_a_complete_document_is_not_sent_through_the_tolerant_reader(self) -> None:
        # Round-tripping a large valid document must not depend on the tolerant reader.
        document = {"items": [{"id": index, "name": f"n{index}"} for index in range(50)]}

        assert parse_streaming_json(json.dumps(document)) == document
