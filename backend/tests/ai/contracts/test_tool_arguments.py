"""Tool parsing preserves model output; validation separately establishes valid arguments."""

import pytest

from app.ai.tools.arguments import parse_partial_arguments


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ('{"city":"Beijing"}', {"city": "Beijing"}),
        ("", {}),
        ("  ", {}),
        ("[]", []),
        ("123", 123),
        ("false", False),
        ('"text"', "text"),
        ("null", None),
    ],
)
def test_complete_json_preserves_its_value(text, expected):
    result = parse_partial_arguments(text)
    assert result == expected
    assert type(result) is type(expected)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ('{"city":"Bei', {"city": "Bei"}),
        ('{"a":[1,{"b":"pa', {"a": [1, {"b": "pa"}]}),
        ('{"a":tru', {"a": True}),
        ('{"a":fals', {"a": False}),
        ('{"a":nul', {"a": None}),
        ("nul", {}),
        ('{"n":1e', {"n": 1}),
        ('{"n":12.', {"n": 12}),
        ('{"x":"line\nbreak"}', {"x": "line\nbreak"}),
        ('{"x":"a\\q"}', {"x": "a\\q"}),
        ('{"x":"a\\q', {"x": "a\\q"}),
        ('{"x":"a\\', {"x": "a"}),
        ('{"x":"\\u5317', {"x": "北"}),
        ("not json", {}),
        ('{"x":}', {}),
    ],
)
def test_partial_and_repaired_json_retains_available_content(text, expected):
    assert parse_partial_arguments(text) == expected


def make_tool(schema):
    from app.ai.messages import ToolDefinition

    return ToolDefinition(name="example", description="Example", parameters=schema)


@pytest.mark.parametrize("value", [[], None, 123, "text", False])
def test_non_object_root_cannot_become_valid_empty_arguments(value):
    from app.ai.errors import ToolValidationError
    from app.ai.tools.arguments import validate_tool_arguments

    tool = make_tool({"type": "object"})
    with pytest.raises(ToolValidationError, match="root"):
        validate_tool_arguments(tool, value)
    assert validate_tool_arguments(tool, {}) == {}


@pytest.mark.parametrize(
    ("kind", "value", "expected"),
    [
        ("integer", "12", 12),
        ("integer", "0x10", 16),
        ("number", "1.25", 1.25),
        ("number", True, 1),
        ("integer", False, 0),
        ("boolean", "true", True),
        ("boolean", "false", False),
        ("boolean", 1, True),
        ("boolean", 0, False),
        ("string", True, "true"),
        ("string", 12, "12"),
        ("string", 1.0, "1"),
        ("null", "", None),
        ("null", 0, None),
        ("null", False, None),
    ],
)
def test_scalar_coercion_uses_declared_type_without_mutating_input(kind, value, expected):
    from app.ai.tools.arguments import validate_tool_arguments

    original = {"value": value}
    tool = make_tool(
        {"type": "object", "properties": {"value": {"type": kind}}, "required": ["value"]}
    )
    result = validate_tool_arguments(tool, original)
    assert result == {"value": expected}
    assert type(result["value"]) is type(expected)
    assert original == {"value": value}


def test_optional_null_restoration_reaches_nested_objects_and_arrays():
    from app.ai.tools.arguments import validate_tool_arguments

    schema = {
        "type": "object",
        "properties": {
            "nullable": {"type": ["string", "null"]},
            "optional": {"type": "integer"},
            "nested": {
                "type": "array",
                "items": {"type": "object", "properties": {"x": {"type": "integer"}}},
            },
        },
    }
    source = {"nullable": None, "optional": None, "nested": [{"x": None}]}
    assert validate_tool_arguments(make_tool(schema), source) == {"nullable": None, "nested": [{}]}
    assert source["optional"] is None and source["nested"] == [{"x": None}]


@pytest.mark.parametrize("kind", ["integer", "number", "boolean", "string"])
def test_required_and_array_null_never_coerce_to_scalar(kind):
    from app.ai.errors import ToolValidationError
    from app.ai.tools.arguments import validate_tool_arguments

    for child, value in [
        ({"type": kind}, None),
        ({"type": "array", "items": {"type": kind}}, [None]),
    ]:
        schema = {"type": "object", "properties": {"value": child}, "required": ["value"]}
        with pytest.raises(ToolValidationError, match="value"):
            validate_tool_arguments(make_tool(schema), {"value": value})


def test_union_preserves_valid_branch_and_coerces_first_valid_candidate():
    from app.ai.tools.arguments import validate_tool_arguments

    schema = {
        "type": "object",
        "properties": {
            "keep": {"anyOf": [{"type": "integer"}, {"type": "string"}]},
            "convert": {"oneOf": [{"type": "integer", "minimum": 10}, {"type": "boolean"}]},
            "both": {"allOf": [{"type": "integer"}, {"minimum": 2}]},
            "nested": {
                "type": "array",
                "items": {"type": "object", "additionalProperties": {"type": "boolean"}},
            },
            "union": {"type": ["integer", "string"]},
        },
    }
    source = {
        "keep": "12",
        "convert": "true",
        "both": "3",
        "nested": [{"enabled": "false"}],
        "union": "4",
    }
    assert validate_tool_arguments(make_tool(schema), source) == {
        "keep": "12",
        "convert": True,
        "both": 3,
        "nested": [{"enabled": False}],
        "union": "4",
    }
    assert source["nested"] == [{"enabled": "false"}]


def test_local_references_do_not_expand_optional_null_or_retrieve_network(monkeypatch):
    import socket

    from app.ai.errors import ToolValidationError
    from app.ai.tools.arguments import validate_tool_arguments

    def forbid(*args, **kwargs):
        raise AssertionError("Unexpected network")

    monkeypatch.setattr(socket, "getaddrinfo", forbid)
    tool = make_tool(
        {
            "type": "object",
            "definitions": {"value": {"type": "integer"}},
            "properties": {"v": {"$ref": "#/definitions/value"}},
        }
    )
    assert validate_tool_arguments(tool, {"v": 2}) == {"v": 2}
    with pytest.raises(ToolValidationError):
        validate_tool_arguments(tool, {"v": None})
    remote = make_tool(
        {"type": "object", "properties": {"v": {"$ref": "https://example.test/schema"}}}
    )
    with pytest.raises(ToolValidationError, match="schema"):
        validate_tool_arguments(remote, {"v": 2})


def test_unknown_tools_missing_fields_and_extra_properties_are_explicit_errors():
    from app.ai.errors import ToolValidationError
    from app.ai.messages import ToolCall
    from app.ai.tools.arguments import validate_tool_call

    tool = make_tool(
        {
            "type": "object",
            "properties": {"count": {"type": "integer", "default": 5}},
            "required": ["count"],
            "additionalProperties": False,
        }
    )
    with pytest.raises(ToolValidationError, match="unknown"):
        validate_tool_call([tool], ToolCall(id="c", name="unknown", arguments={}))
    with pytest.raises(ToolValidationError) as missing:
        validate_tool_call([tool], ToolCall(id="c", name="example", arguments={}))
    assert missing.value.path == "count"
    with pytest.raises(ToolValidationError, match="Additional"):
        validate_tool_call(
            [tool], ToolCall(id="c", name="example", arguments={"count": 1, "extra": 2})
        )
    call = ToolCall(id="c", name="example", arguments={"count": "2"})
    assert validate_tool_call([tool], call) == {"count": 2}
    assert call.arguments == {"count": "2"}


@pytest.mark.parametrize(
    ("value", "expected"), [(1e-7, "1e-7"), (1e-6, "0.000001"), (1e21, "1e+21"), (-0.0, "0")]
)
def test_number_to_string_uses_pi_number_format(value, expected):
    from app.ai.tools.arguments import validate_tool_arguments

    tool = make_tool({"type": "object", "properties": {"value": {"type": "string"}}})
    assert validate_tool_arguments(tool, {"value": value}) == {"value": expected}
