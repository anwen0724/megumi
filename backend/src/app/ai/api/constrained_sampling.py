"""Turning a caller's tool definition into what a provider's constrained sampling accepts.

A caller can ask for a tool call to be constrained: to a JSON schema, or to a grammar with
one encoding per provider. Two problems stand between that request and the wire. First, the
"strict" JSON-schema form the providers accept is a small subset of JSON Schema — no
references, no unions of objects or arrays, no open objects — so a schema has to be
checked, and an optional property has to be widened to accept null because strict mode
requires every declared property to be present. Second, a grammar arrives as a string in
the tool's arguments, and that string is streamed, so the deltas that carry it have to be
converted into the JSON text that reconstructs the same object.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from app.ai.types import GrammarFormat, GrammarSampling, Tool

__all__ = [
    "UNSUPPORTED_STRICT_SCHEMA_KEYS",
    "GrammarConstrainedSampling",
    "GrammarToolInputJsonBuffer",
    "GrammarToolInputResolution",
    "UnsupportedStrictJsonSchemaError",
    "append_grammar_tool_input_json_delta",
    "create_grammar_tool_input_properties",
    "get_grammar_tool_input",
    "get_json_schema_tool_parameters",
    "infer_grammar_input_property",
    "make_strict_json_schema",
    "resolve_grammar_constrained_sampling",
    "resolve_json_schema_strict_sampling",
]

# JSON Schema keywords that express structure the strict subset cannot carry.
UNSUPPORTED_STRICT_SCHEMA_KEYS = (
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
)


class UnsupportedStrictJsonSchemaError(Exception):
    """The schema uses a keyword the strict subset does not allow."""


@dataclass(slots=True)
class GrammarConstrainedSampling:
    """A grammar to enforce, in the format the provider expects."""

    format: str
    definition: str
    inputProperty: str


@dataclass(slots=True)
class GrammarToolInputJsonBuffer:
    """The JSON text built for one grammar-constrained tool call so far."""

    input: str = ""
    started: bool = False
    closed: bool = False


class GrammarToolInputResolution(Protocol):
    """What :func:`resolve_grammar_constrained_sampling` returns for a constrained tool."""

    @property
    def format(self) -> str:
        """The grammar format, `lark` or `regex`."""
        ...

    @property
    def definition(self) -> str:
        """The grammar itself."""
        ...

    @property
    def inputProperty(self) -> str:
        """The argument the grammar constrains."""
        ...


def _is_schema_object(value: Any) -> bool:
    """Whether ``value`` is a schema mapping rather than an array or scalar."""

    return isinstance(value, Mapping)


def _is_structured_schema(schema: Any) -> bool:
    """Whether ``schema`` describes an object or an array."""

    if not _is_schema_object(schema):
        return False
    declared = schema.get("type")
    if isinstance(declared, str):
        types = [declared]
    elif isinstance(declared, list):
        types = list(declared)
    else:
        types = []
    return (
        "object" in types
        or "array" in types
        or schema.get("properties") is not None
        or schema.get("items") is not None
    )


def _schema_allows_null(schema: Any) -> bool:
    """Whether ``schema`` already accepts null, directly or through a union."""

    if not _is_schema_object(schema):
        return False
    declared = schema.get("type")
    if declared == "null":
        return True
    if isinstance(declared, list) and "null" in declared:
        return True
    if "const" in schema and schema["const"] is None:
        return True
    enum = schema.get("enum")
    if isinstance(enum, list) and None in enum:
        return True
    any_of = schema.get("anyOf")
    return isinstance(any_of, list) and any(_schema_allows_null(variant) for variant in any_of)


def _make_schema_node_strict(schema: Any) -> None:
    """Check and rewrite one schema node in place for strict mode.

    Raises rather than returning a flag, because the caller needs to know which keyword was
    refused in order to report it.
    """

    if not _is_schema_object(schema):
        raise UnsupportedStrictJsonSchemaError("boolean schemas are unsupported")
    for key in UNSUPPORTED_STRICT_SCHEMA_KEYS:
        if schema.get(key) is not None:
            raise UnsupportedStrictJsonSchemaError(f"{key} schemas are unsupported")

    any_of = schema.get("anyOf")
    if any_of is not None:
        if not isinstance(any_of, list) or len(any_of) == 0:
            raise UnsupportedStrictJsonSchemaError("anyOf must contain at least one schema")
        for variant in any_of:
            if _is_structured_schema(variant):
                raise UnsupportedStrictJsonSchemaError("object and array unions are unsupported")
            _make_schema_node_strict(variant)

    items = schema.get("items")
    if items is not None:
        if isinstance(items, list):
            raise UnsupportedStrictJsonSchemaError("tuple schemas are unsupported")
        _make_schema_node_strict(items)

    is_object_schema = schema.get("type") == "object"
    properties = schema.get("properties")
    if properties is not None and not is_object_schema:
        raise UnsupportedStrictJsonSchemaError("properties require type object")
    if not is_object_schema:
        return

    additional = schema.get("additionalProperties")
    if additional is not None and additional is not False:
        raise UnsupportedStrictJsonSchemaError(
            "schema-valued or true additionalProperties is unsupported",
        )
    if properties is not None and not _is_schema_object(properties):
        raise UnsupportedStrictJsonSchemaError("object properties must be a schema map")

    required = schema.get("required")
    if required is not None and (
        not isinstance(required, list) or any(not isinstance(key, str) for key in required)
    ):
        raise UnsupportedStrictJsonSchemaError("object required must be a string array")

    property_map: dict[str, Any] = properties
    property_names = list(property_map)
    required_names = set(required) if isinstance(required, list) else set()
    if any(key not in property_names for key in required_names):
        raise UnsupportedStrictJsonSchemaError("required contains an unknown property")

    for key, property_schema in list(property_map.items()):
        _make_schema_node_strict(property_schema)
        # Strict mode requires every declared property to be present, so an optional one is
        # widened to accept null rather than being left out.
        if key not in required_names and not _schema_allows_null(property_schema):
            property_map[key] = {"anyOf": [property_schema, {"type": "null"}]}

    schema["required"] = property_names
    schema["additionalProperties"] = False


def make_strict_json_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Convert a tool schema to the strict subset providers accept.

    The input is not modified; a deep copy is rewritten and returned.
    """

    cloned: dict[str, Any] = copy.deepcopy(schema)
    if not _is_schema_object(cloned):
        raise UnsupportedStrictJsonSchemaError("root schema must have type object")
    _make_schema_node_strict(cloned)
    if cloned.get("type") != "object":
        raise UnsupportedStrictJsonSchemaError("root schema must have type object")
    return cloned


def get_json_schema_tool_parameters(tool: Tool, strict: bool | None) -> dict[str, Any]:
    """The parameters to declare for ``tool``, made strict when the caller asked for it."""

    if strict is True:
        return make_strict_json_schema(tool.parameters)
    return tool.parameters


def get_grammar_tool_input(
    tool_name: str,
    arguments: dict[str, Any],
    input_property: str,
) -> str:
    """The grammar string a constrained tool call carried in its arguments."""

    value = arguments.get(input_property)
    if not isinstance(value, str):
        raise ValueError(
            f'Grammar tool call "{tool_name}" requires argument "{input_property}" to be a string.',
        )
    return value


def append_grammar_tool_input_json_delta(
    buffer: GrammarToolInputJsonBuffer,
    input_property: str,
    next_input: str,
    close: bool,
) -> str | None:
    """Extend the JSON text for a streamed grammar input and return what to emit.

    The arguments arrive as a growing string, so each step emits the JSON fragment that
    turns the text so far into the object the provider expected. Returns ``None`` when there
    is nothing to emit.
    """

    if buffer.closed:
        if close and next_input == buffer.input:
            return None
        raise ValueError(
            f'grammar tool input for property "{input_property}" changed after it was closed',
        )
    if not next_input.startswith(buffer.input):
        raise ValueError(
            f'grammar tool input for property "{input_property}" changed non-monotonically',
        )

    input_delta = next_input[len(buffer.input) :]
    if not close and len(input_delta) == 0:
        return None

    delta = ""
    if not buffer.started:
        delta += f"{{{json.dumps(input_property)}:\""
        buffer.started = True
    # The fragment is the delta with its surrounding quotes removed, so it can be appended
    # to the JSON string already in flight.
    delta += json.dumps(input_delta)[1:-1]
    buffer.input = next_input

    if close:
        delta += '"}'
        buffer.closed = True
    return delta


def infer_grammar_input_property(tool: Tool) -> str:
    """The single required string property a grammar-constrained tool must declare."""

    schema: Any = tool.parameters
    if schema.get("type") != "object":
        raise ValueError("grammar constrained sampling requires an object parameter schema")
    required = schema.get("required")
    if not isinstance(required, list) or len(required) != 1 or not isinstance(required[0], str):
        raise ValueError(
            "grammar constrained sampling requires exactly one required string property",
        )

    input_property = required[0]
    properties = schema.get("properties")
    if not isinstance(properties, Mapping) or input_property not in properties:
        raise ValueError(
            f"grammar constrained sampling requires a properties entry for {input_property}",
        )
    if properties[input_property].get("type") != "string":
        raise ValueError(
            f"grammar constrained sampling property {input_property} must have type string",
        )
    return input_property


def _uses(config: Any, kind: str) -> bool:
    """Whether a tool's constrained-sampling setting asks for ``kind``."""

    return config is not None and getattr(config, "type", None) == kind


def _as_grammar(config: Any) -> GrammarSampling | None:
    """``config`` as grammar sampling, or ``None`` when it asks for something else."""

    return config if isinstance(config, GrammarSampling) else None


def resolve_json_schema_strict_sampling(tool: Tool, supports_strict_mode: bool) -> bool | None:
    """Whether to declare ``tool`` with a strict schema.

    ``None`` means strict mode is not applicable and the schema should be sent as written.
    A tool that requires strict mode fails rather than silently being sent unconstrained,
    because the caller asked for a guarantee the provider cannot give.
    """

    config = tool.constrainedSampling
    if not _uses(config, "json_schema"):
        return None
    strict = getattr(config, "strict", None)

    if supports_strict_mode:
        try:
            make_strict_json_schema(tool.parameters)
        except UnsupportedStrictJsonSchemaError as error:
            if strict != "require":
                return None
            raise ValueError(
                f'Tool "{tool.name}" requires JSON-schema constrained sampling, but {error}.',
            ) from error
        return True

    if strict == "require":
        raise ValueError(
            f'Tool "{tool.name}" requires JSON-schema constrained sampling, '
            "but strict tools are unsupported.",
        )
    return None


def resolve_grammar_constrained_sampling(
    tool: Tool,
    supports_openai_grammar_tools: bool,
) -> GrammarConstrainedSampling | None:
    """The grammar to enforce for ``tool``, or ``None`` when it is not grammar-constrained."""

    grammar = _as_grammar(tool.constrainedSampling)
    if grammar is None or not supports_openai_grammar_tools:
        return None

    variants = grammar.variants
    lark = variants.get(GrammarFormat.OPENAI_LARK)
    regex = variants.get(GrammarFormat.OPENAI_REGEX)
    has_lark = isinstance(lark, str) and lark.strip() != ""
    has_regex = isinstance(regex, str) and regex.strip() != ""
    if not has_lark and not has_regex:
        raise ValueError(
            f'Tool "{tool.name}" cannot use grammar constrained sampling: '
            "no supported grammar variant was provided.",
        )

    try:
        lark_definition = lark or ""
        regex_definition = regex or ""
        return GrammarConstrainedSampling(
            format="lark" if has_lark else "regex",
            definition=lark_definition if has_lark else regex_definition,
            inputProperty=infer_grammar_input_property(tool),
        )
    except ValueError as error:
        raise ValueError(
            f'Tool "{tool.name}" cannot use grammar constrained sampling: {error}.',
        ) from error


def create_grammar_tool_input_properties(
    tools: Sequence[Tool] | None,
    supports_openai_grammar_tools: bool,
) -> dict[str, str]:
    """Map each grammar-constrained tool to the argument its grammar constrains."""

    properties: dict[str, str] = {}
    for tool in tools or []:
        grammar = resolve_grammar_constrained_sampling(tool, supports_openai_grammar_tools)
        if grammar is not None:
            properties[tool.name] = grammar.inputProperty
    return properties
