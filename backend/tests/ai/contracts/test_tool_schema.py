"""Provider strict schemas pair with independent local argument validation."""

from copy import deepcopy

import pytest

from app.ai.messages import JsonSchemaSampling, Tool
from app.ai.tools.arguments import validate_tool_arguments
from app.ai.tools.schema import make_strict_json_schema


def test_optional_schema_conversion_pairs_with_original_argument_validation():
    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "limit": {"type": "integer"},
            "options": {"type": "object", "properties": {"enabled": {"type": "boolean"}}},
        },
        "required": ["name"],
    }
    original = deepcopy(schema)
    strict = make_strict_json_schema(schema)
    assert strict["additionalProperties"] is False
    assert strict["required"] == ["name", "limit", "options"]
    assert strict["properties"]["limit"] == {"anyOf": [{"type": "integer"}, {"type": "null"}]}
    nested = strict["properties"]["options"]["anyOf"][0]
    assert nested["additionalProperties"] is False and nested["required"] == ["enabled"]
    tool = Tool(name="t", description="", parameters=schema)
    assert validate_tool_arguments(
        tool, {"name": "hi", "limit": None, "options": {"enabled": None}}
    ) == {"name": "hi", "options": {}}
    assert schema == original


@pytest.mark.parametrize(
    "child",
    [
        {"$ref": "#/$defs/a"},
        {"allOf": [{"type": "string"}]},
        {"oneOf": [{"type": "string"}]},
        {"type": "array", "items": [{"type": "string"}]},
        True,
        {"type": "object", "additionalProperties": True},
        {"type": "object", "additionalProperties": {"type": "string"}},
        {"properties": {"x": {"type": "string"}}},
        {"type": "object", "required": ["missing"]},
        {"anyOf": [{"type": "object"}, {"type": "null"}]},
        {"anyOf": []},
    ],
)
def test_unsupported_strict_shapes_fall_back_or_fail_without_rewriting_semantics(child):
    from app.ai.errors import StrictSchemaError
    from app.ai.tools.schema import resolve_json_schema_strict_sampling

    schema = {"type": "object", "properties": {"x": child}}
    tool = Tool(
        name="t",
        description="",
        parameters=schema,
        constrained_sampling=JsonSchemaSampling(strict="prefer"),
    )
    assert resolve_json_schema_strict_sampling(tool, True) is None
    tool.constrained_sampling = JsonSchemaSampling(strict="require")
    with pytest.raises(StrictSchemaError):
        resolve_json_schema_strict_sampling(tool, True)
    with pytest.raises(StrictSchemaError):
        make_strict_json_schema(schema)


def test_scalar_unions_and_capability_sampling_modes():
    from app.ai.errors import StrictSchemaError
    from app.ai.tools.schema import resolve_json_schema_strict_sampling

    schema = {
        "type": "object",
        "properties": {"value": {"anyOf": [{"type": "string"}, {"type": "null"}]}},
    }
    assert make_strict_json_schema(schema)["properties"]["value"] == schema["properties"]["value"]
    tool = Tool(name="t", description="", parameters=schema)
    assert resolve_json_schema_strict_sampling(tool, True) is None
    tool.constrained_sampling = False
    assert resolve_json_schema_strict_sampling(tool, True) is None
    tool.constrained_sampling = JsonSchemaSampling(strict="prefer")
    assert resolve_json_schema_strict_sampling(tool, True) is True
    assert resolve_json_schema_strict_sampling(tool, False) is None
    tool.constrained_sampling = JsonSchemaSampling(strict="require")
    with pytest.raises(StrictSchemaError):
        resolve_json_schema_strict_sampling(tool, False)
