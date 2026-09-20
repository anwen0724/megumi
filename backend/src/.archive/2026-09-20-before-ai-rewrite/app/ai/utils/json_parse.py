"""Parsing JSON that a model produced, including JSON that is still arriving.

Two problems come up with model-generated JSON that ordinary parsing does not handle.
The first is text that is *almost* valid: a string literal containing a raw control
character or a backslash that does not start a valid escape (a Windows path is the common
case, where ``C:\\dir`` looks like an escape sequence). The second is text that is not
finished yet, because it is being streamed and the tool-call arguments arrive in pieces.

:func:`parse_streaming_json` therefore degrades through five attempts and never raises. The
caller always gets a mapping back, possibly empty, which is what lets a partly-received
tool call be reported as partially-filled arguments instead of an error.
"""

from __future__ import annotations

import json
import re
from typing import Any

__all__ = [
    "parse_json_with_repair",
    "parse_streaming_json",
    "repair_json",
]

VALID_JSON_ESCAPES = frozenset({'"', "\\", "/", "b", "f", "n", "r", "t", "u"})

_UNICODE_ESCAPE = re.compile(r"^[0-9a-fA-F]{4}$")


class _PartialJson(Exception):
    """The text ended before the value did, which the streaming parser tolerates."""


class _MalformedJson(Exception):
    """The text is not JSON in a way that finishing it would not fix."""


def _parse_constant(literal: str) -> Any:
    """Map the non-standard numeric literals a partial parse may produce."""

    if literal == "Infinity":
        return float("inf")
    if literal == "-Infinity":
        return float("-inf")
    if literal == "NaN":
        return float("nan")
    raise _MalformedJson(f"Unrecognized constant {literal}")


# The decoder used for every parse, configured to accept the two numeric literals the
# reference's partial parser also accepts.
_DECODER = json.JSONDecoder(parse_constant=_parse_constant)


def _is_control_character(char: str) -> bool:
    """Whether ``char`` is a raw control character that must be escaped inside a string."""

    return 0x00 <= ord(char) <= 0x1F


def _escape_control_character(char: str) -> str:
    """The escape sequence that replaces a raw control character."""

    named = {
        "\b": "\\b",
        "\f": "\\f",
        "\n": "\\n",
        "\r": "\\r",
        "\t": "\\t",
    }
    if char in named:
        return named[char]
    return f"\\u{ord(char):04x}"


def repair_json(source: str) -> str:
    """Make an almost-valid JSON document valid.

    Two repairs are applied, both only inside string literals: raw control characters are
    escaped, and a backslash that does not begin a valid escape is doubled so it reads as
    a literal backslash. Outside a string literal the text is passed through unchanged.

    Doubling rather than dropping is what keeps a Windows path intact: the reference
    behaviour is that ``"C:\\dir"`` becomes ``"C:\\\\dir"``, which parses back to the
    original ``C:\\dir``.
    """

    repaired: list[str] = []
    in_string = False
    index = 0
    while index < len(source):
        char = source[index]

        if not in_string:
            repaired.append(char)
            if char == '"':
                in_string = True
            index += 1
            continue

        if char == '"':
            repaired.append(char)
            in_string = False
            index += 1
            continue

        if char == "\\":
            next_char = source[index + 1] if index + 1 < len(source) else None
            if next_char is None:
                repaired.append("\\\\")
                index += 1
                continue

            if next_char == "u":
                digits = source[index + 2 : index + 6]
                if _UNICODE_ESCAPE.match(digits):
                    repaired.append(f"\\u{digits}")
                    index += 6
                    continue
                # A ``u`` that does not begin four hex digits is not a unicode escape, and
                # must not be accepted just because ``u`` is a legal escape letter.
                repaired.append("\\\\")
                index += 1
                continue

            if next_char in VALID_JSON_ESCAPES:
                repaired.append(f"\\{next_char}")
                index += 2
                continue

            repaired.append("\\\\")
            index += 1
            continue

        repaired.append(_escape_control_character(char) if _is_control_character(char) else char)
        index += 1

    return "".join(repaired)


def parse_json_with_repair(source: str) -> Any:
    """Parse JSON, retrying once against the repaired text when parsing fails.

    A failure is re-raised unchanged when repair could not improve the text, so the
    caller's error describes what actually arrived.
    """

    try:
        return json.loads(source)
    except ValueError:
        repaired = repair_json(source)
        if repaired != source:
            return json.loads(repaired)
        raise


def parse_streaming_json(partial_json: str | None) -> Any:
    """Parse JSON that may be incomplete, never raising.

    The attempts are, in order: the text as it stands; the repaired text; a tolerant parse
    of the text; a tolerant parse of the repaired text; and an empty mapping. An empty
    mapping is the floor, so a caller can read the result's keys without checking whether
    anything was parseable yet.
    """

    if not partial_json or partial_json.strip() == "":
        return {}

    try:
        return parse_json_with_repair(partial_json)
    except ValueError:
        pass

    try:
        return _parse_partial(partial_json)
    except (ValueError, _PartialJson, _MalformedJson):
        pass

    try:
        return _parse_partial(repair_json(partial_json))
    except (ValueError, _PartialJson, _MalformedJson):
        return {}


def _parse_partial(source: str) -> Any:
    """Parse possibly-incomplete JSON, returning whatever value the text supports.

    A composite value that ends early is returned with the members that did arrive; a
    scalar that ends early is completed when its text is an unambiguous prefix.
    """

    text = source.strip()
    if not text:
        raise _MalformedJson("empty input")
    return _PartialReader(text).read()


class _PartialReader:
    """A recursive-descent reader that tolerates a truncated document."""

    def __init__(self, text: str) -> None:
        self._text = text
        self._length = len(text)
        self._index = 0

    def read(self) -> Any:
        """Read the single value the document contains."""

        return self._read_any()

    def _skip_blank(self) -> None:
        while self._index < self._length and self._text[self._index] in " \n\r\t":
            self._index += 1

    def _read_any(self) -> Any:
        self._skip_blank()
        if self._index >= self._length:
            raise _PartialJson("Unexpected end of input")

        char = self._text[self._index]
        if char == '"':
            return self._read_string()
        if char == "{":
            return self._read_object()
        if char == "[":
            return self._read_array()
        for literal, value in (
            ("null", None),
            ("true", True),
            ("false", False),
            ("Infinity", float("inf")),
            ("-Infinity", float("-inf")),
            ("NaN", float("nan")),
        ):
            if self._starts_with(literal):
                self._index += len(literal)
                return value
        return self._read_number()

    def _starts_with(self, literal: str) -> bool:
        """Whether the remaining text is ``literal`` or a prefix of it that ends the text.

        A prefix only counts when the text ends on it, so ``nul`` reads as ``null`` while
        ``nullx`` does not.
        """

        remaining = self._length - self._index
        candidate = self._text[self._index : self._index + len(literal)]
        if candidate == literal:
            return True
        return remaining < len(literal) and literal.startswith(candidate)

    def _read_string(self) -> str:
        """Read a string literal, completing one that was cut off mid-way."""

        start = self._index
        escaped = False
        self._index += 1
        while self._index < self._length and (
            self._text[self._index] != '"' or (escaped and self._text[self._index - 1] == "\\")
        ):
            escaped = not escaped if self._text[self._index] == "\\" else False
            self._index += 1

        if self._char_at(self._index) == '"':
            self._index += 1
            return self._decode_string(self._text[start : self._index - int(escaped)])

        # The string never closed. Close it here, unless the text ends on a backslash that
        # cannot be escaped, in which case the backslash is dropped instead.
        truncated = self._text[start : self._index - int(escaped)]
        try:
            return self._decode_string(truncated + '"')
        except ValueError:
            last_backslash = self._text.rfind("\\")
            return self._decode_string(self._text[start:last_backslash] + '"')

    def _char_at(self, index: int) -> str:
        """The character at ``index``, or an empty string past the end of the text."""

        return self._text[index] if index < self._length else ""

    def _decode_string(self, literal: str) -> str:
        """Decode a complete JSON string literal."""

        try:
            value = _DECODER.decode(literal)
        except ValueError as error:
            raise _MalformedJson(str(error)) from error
        if not isinstance(value, str):
            raise _MalformedJson("expected a string literal")
        return value

    def _read_object(self) -> dict[str, Any]:
        """Read an object, keeping the members that arrived before the text ended."""

        self._index += 1
        result: dict[str, Any] = {}
        self._skip_blank()
        try:
            while self._char_at(self._index) != "}":
                self._skip_blank()
                if self._index >= self._length:
                    return result
                key = self._read_string()
                self._skip_blank()
                self._index += 1
                try:
                    result[key] = self._read_any()
                except (_PartialJson, _MalformedJson):
                    return result
                self._skip_blank()
                if self._char_at(self._index) == ",":
                    self._index += 1
        except (_PartialJson, _MalformedJson):
            return result
        self._index += 1
        return result

    def _read_array(self) -> list[Any]:
        """Read an array, keeping the elements that arrived before the text ended."""

        self._index += 1
        result: list[Any] = []
        try:
            while self._char_at(self._index) != "]":
                result.append(self._read_any())
                self._skip_blank()
                if self._char_at(self._index) == ",":
                    self._index += 1
        except (_PartialJson, _MalformedJson):
            return result
        self._index += 1
        return result

    def _read_number(self) -> int | float:
        """Read a number, discarding an exponent that never finished arriving."""

        if self._index == 0:
            raise _MalformedJson("expected a value")
        start = self._index
        if self._char_at(self._index) == "-":
            self._index += 1
        while self._index < self._length and self._char_at(self._index) not in ",]}":
            self._index += 1

        literal = self._text[start : self._index]
        try:
            return _as_number(_DECODER.decode(literal))
        except ValueError as error:
            last_exponent = literal.rfind("e")
            if last_exponent > 0:
                try:
                    return _as_number(_DECODER.decode(literal[:last_exponent]))
                except ValueError:
                    pass
            if literal == "-":
                raise _PartialJson("Not sure what '-' is") from error
            raise _MalformedJson(str(error)) from error


def _as_number(value: Any) -> int | float:
    """Narrow a decoded scalar to a number, rejecting anything else."""

    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _MalformedJson("expected a number")
    return value
