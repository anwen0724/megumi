"""Local JSON Schema checks and provider strict conversion have separate responsibilities."""

from collections.abc import Iterator
from copy import deepcopy

from jsonschema import Draft7Validator
from jsonschema.exceptions import SchemaError, ValidationError
from referencing import Registry
from referencing.exceptions import Unresolvable

from app.ai.errors import StrictSchemaError, ToolValidationError
from app.ai.messages import JSONValue, ToolDefinition


def schema_errors(
    schema: dict[str, JSONValue] | bool, value: JSONValue
) -> Iterator[ValidationError]:
    """Validate pi-style schema keywords and local refs without a remote retriever."""
    try:
        Draft7Validator.check_schema(schema)
        yield from Draft7Validator(schema, registry=Registry()).iter_errors(value)
    except (SchemaError, Unresolvable) as exc:
        raise ToolValidationError("schema", str(exc)) from exc


def schema_accepts(schema: dict[str, JSONValue] | bool, value: JSONValue) -> bool:
    """Check one branch for conversion decisions, keeping unresolved branches unselected."""
    try:
        return next(schema_errors(schema, value), None) is None
    except ToolValidationError:
        return False


def make_strict_json_schema(schema: dict[str, JSONValue]) -> dict[str, JSONValue]:
    """Copy a tool schema and make optional properties nullable and required."""
    result = deepcopy(schema)
    _make_strict_node(result)
    if result.get("type") != "object":
        raise StrictSchemaError("root schema must have type object")
    return result


def _allows_null(schema: dict[str, JSONValue]) -> bool:
    """Recognize explicit nullable declarations without adding redundant branches."""
    kinds = schema.get("type")
    enum = schema.get("enum")
    variants = schema.get("anyOf")
    return (
        kinds == "null"
        or (isinstance(kinds, list) and "null" in kinds)
        or ("const" in schema and schema["const"] is None)
        or (isinstance(enum, list) and None in enum)
        or (
            isinstance(variants, list)
            and any(isinstance(v, dict) and _allows_null(v) for v in variants)
        )
    )


_UNSUPPORTED_STRICT_KEYS = {
    "$ref",
    "$defs",
    "definitions",
    "allOf",
    "oneOf",
    "patternProperties",
    "dependentSchemas",
    "dependencies",
    "unevaluatedProperties",
    "propertyNames",
    "contains",
    "prefixItems",
    "not",
    "if",
    "then",
    "else",
}


def _make_strict_node(schema: JSONValue) -> None:
    """Reject unsupported structures rather than silently tightening their meaning."""
    if not isinstance(schema, dict):
        raise StrictSchemaError("boolean and non-object schemas are unsupported")
    for key in _UNSUPPORTED_STRICT_KEYS:
        if key in schema:
            raise StrictSchemaError(f"{key} is outside the strict subset")
    if "anyOf" in schema:
        variants = schema["anyOf"]
        if not isinstance(variants, list) or not variants:
            raise StrictSchemaError("anyOf must contain at least one schema")
        for variant in variants:
            if isinstance(variant, dict):
                kinds = variant.get("type")
                kinds = [kinds] if isinstance(kinds, str) else kinds
                if (
                    "properties" in variant
                    or "items" in variant
                    or (isinstance(kinds, list) and any(k in kinds for k in ("object", "array")))
                ):
                    raise StrictSchemaError("structured unions are unsupported")
            _make_strict_node(variant)
    if "items" in schema:
        if isinstance(schema["items"], list):
            raise StrictSchemaError("tuple items are unsupported")
        _make_strict_node(schema["items"])
    if "properties" in schema and schema.get("type") != "object":
        raise StrictSchemaError("properties require type object")
    if schema.get("type") != "object":
        return
    if "additionalProperties" in schema and schema["additionalProperties"] is not False:
        raise StrictSchemaError("additionalProperties cannot be true or a schema")
    properties = schema.get("properties", {})
    required = schema.get("required", [])
    if not isinstance(properties, dict):
        raise StrictSchemaError("properties must be a schema map")
    if not isinstance(required, list) or any(not isinstance(key, str) for key in required):
        raise StrictSchemaError("required must contain property names")
    if any(key not in properties for key in required):
        raise StrictSchemaError("required contains an unknown property")
    for key, child in properties.items():
        _make_strict_node(child)
        if isinstance(child, dict) and key not in required and not _allows_null(child):
            properties[key] = {"anyOf": [child, {"type": "null"}]}
    schema["required"] = list(properties)
    schema["additionalProperties"] = False


def resolve_json_schema_strict_sampling(
    tool: ToolDefinition, supports_strict_mode: bool
) -> bool | None:
    """Enable strict only when supported; prefer falls back and require raises."""
    config = tool.constrained_sampling
    if config is None or config is False:
        return None
    try:
        if not supports_strict_mode:
            raise StrictSchemaError("protocol does not support strict sampling")
        make_strict_json_schema(tool.parameters)
        return True
    except StrictSchemaError:
        if config.strict == "require":
            raise
        return None
