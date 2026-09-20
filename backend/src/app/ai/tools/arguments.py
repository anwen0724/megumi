"""Parse model-generated JSON separately from tool argument validation."""

import json
import math
import re
from collections.abc import Sequence
from copy import deepcopy
from decimal import Decimal
from typing import cast

from partial_json_parser import loads as partial_loads  # type: ignore[import-untyped]

from app.ai.errors import ToolValidationError
from app.ai.messages import JSONValue, ToolCall, ToolDefinition
from app.ai.tools.schema import schema_accepts, schema_errors


def repair_json(text: str) -> str:
    """Escape raw controls and invalid string escapes without changing valid escapes."""
    out: list[str] = []
    inside = False
    index = 0
    while index < len(text):
        char = text[index]
        if not inside:
            out.append(char)
            if char == '"':
                inside = True
        elif char == '"':
            out.append(char)
            inside = False
        elif char == "\\":
            following = text[index + 1 : index + 2]
            if following and following in '"\\/bfnrtu':
                out.extend((char, following))
                index += 1
            else:
                out.append("\\\\")
        elif ord(char) <= 31:
            out.append(json.dumps(char)[1:-1])
        else:
            out.append(char)
        index += 1
    return "".join(out)


def parse_partial_arguments(text: str | None) -> JSONValue:
    """Try complete, repaired, partial and repaired-partial JSON without validating a tool."""
    if not text or not text.strip():
        return {}
    repaired = repair_json(text)
    for candidate in (text, repaired):
        try:
            return cast(JSONValue, json.loads(candidate))
        except ValueError:
            pass
    for candidate in (text, repaired):
        try:
            result = cast(JSONValue, partial_loads(candidate))
            return {} if result is None else result
        except (ValueError, IndexError):
            pass
    return {}


def validate_tool_arguments(tool: ToolDefinition, arguments: JSONValue) -> dict[str, JSONValue]:
    """Copy and validate arguments without executing or changing the caller's data."""
    if not isinstance(arguments, dict):
        raise ToolValidationError("root", "tool arguments must be an object")
    result = deepcopy(arguments)
    _normalize_optional_nulls(result, tool.parameters)
    result = cast(dict[str, JSONValue], _coerce(result, tool.parameters))
    errors = list(schema_errors(tool.parameters, result))
    if errors:
        error = errors[0]
        parts = [str(part) for part in error.absolute_path]
        if (
            error.validator == "required"
            and isinstance(error.instance, dict)
            and isinstance(error.validator_value, list)
        ):
            missing = next(
                (key for key in error.validator_value if key not in error.instance), None
            )
            if missing is not None:
                parts.append(missing)
        path = ".".join(parts) or "root"
        raise ToolValidationError(path, error.message)
    return result


def _primitive(value: JSONValue, kind: str) -> JSONValue:
    """Mirror pi scalar conversion, deliberately excluding native null conversion."""
    if value is None:
        return value
    if kind in ("integer", "number"):
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, str):
            text = value.strip()
            number: int | float
            try:
                if re.fullmatch(r"0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+", text):
                    number = int(text, 0)
                elif re.fullmatch(
                    r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", text
                ):
                    number = float(text)
                else:
                    return value
            except (ValueError, OverflowError):
                return value
            if math.isfinite(number) and (kind == "number" or float(number).is_integer()):
                return int(number) if float(number).is_integer() else number
    elif kind == "boolean":
        if value == "true" or (type(value) in (int, float) and value == 1):
            return True
        if value == "false" or (type(value) in (int, float) and value == 0):
            return False
    elif kind == "string":
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (int, float)):
            return _number_text(value)
    elif kind == "null" and (value == "" or value == 0):
        return None
    return value


def _coerce(value: JSONValue, schema: dict[str, JSONValue] | bool) -> JSONValue:
    """Convert explicitly typed properties/items while preserving already-valid unions."""
    if isinstance(schema, bool):
        return value
    all_of = schema.get("allOf")
    if isinstance(all_of, list):
        for child in all_of:
            if isinstance(child, (dict, bool)):
                value = _coerce(value, child)
    for keyword in ("anyOf", "oneOf"):
        variants = schema.get(keyword)
        if not isinstance(variants, list):
            continue
        branches = [child for child in variants if isinstance(child, (dict, bool))]
        if any(schema_accepts(child, value) for child in branches):
            continue
        for child in branches:
            candidate = _coerce(deepcopy(value), child)
            if schema_accepts(child, candidate):
                value = candidate
                break
    declared = schema.get("type")
    kinds = (
        [declared] if isinstance(declared, str) else declared if isinstance(declared, list) else []
    )
    if not (
        len(kinds) > 1
        and any(isinstance(k, str) and schema_accepts({"type": k}, value) for k in kinds)
    ):
        for kind in kinds:
            if isinstance(kind, str):
                candidate = _primitive(value, kind)
                if candidate != value or type(candidate) is not type(value):
                    value = candidate
                    break
    if isinstance(value, dict) and "object" in kinds:
        properties = schema.get("properties")
        if isinstance(properties, dict):
            for name, child in properties.items():
                if name in value and isinstance(child, (dict, bool)):
                    value[name] = _coerce(value[name], child)
        additional = schema.get("additionalProperties")
        if isinstance(additional, dict):
            for name in value:
                if not isinstance(properties, dict) or name not in properties:
                    value[name] = _coerce(value[name], additional)
    if isinstance(value, list) and "array" in kinds:
        items = schema.get("items")
        for index, item in enumerate(value):
            child = items[index] if isinstance(items, list) and index < len(items) else items
            if isinstance(child, (dict, bool)):
                value[index] = _coerce(item, child)
    return value


def _normalize_optional_nulls(value: JSONValue, schema: dict[str, JSONValue] | bool) -> None:
    """Undo nullable optional strict fields without dereferencing or inventing defaults."""
    if isinstance(schema, bool):
        return
    if isinstance(value, list):
        items = schema.get("items")
        for index, item in enumerate(value):
            child = items[index] if isinstance(items, list) and index < len(items) else items
            if isinstance(child, (dict, bool)):
                _normalize_optional_nulls(item, child)
    elif isinstance(value, dict):
        properties = schema.get("properties")
        required = schema.get("required", [])
        if not isinstance(properties, dict):
            return
        for name, child in properties.items():
            if name not in value or not isinstance(child, (dict, bool)):
                continue
            is_ref = isinstance(child, dict) and isinstance(child.get("$ref"), str)
            if (
                value[name] is None
                and isinstance(required, list)
                and name not in required
                and not is_ref
                and not schema_accepts(child, None)
            ):
                del value[name]
            else:
                _normalize_optional_nulls(value[name], child)


def validate_tool_call(
    tools: Sequence[ToolDefinition], tool_call: ToolCall
) -> dict[str, JSONValue]:
    """Find the declared tool and return validated arguments without executing it."""
    tool = next((tool for tool in tools if tool.name == tool_call.name), None)
    if tool is None:
        raise ToolValidationError("tool", f'unknown tool "{tool_call.name}"')
    return validate_tool_arguments(tool, tool_call.arguments)


def _number_text(value: int | float) -> str:
    """Use pi/JavaScript decimal-versus-exponent thresholds, not Python repr defaults."""
    number = Decimal(str(value))
    if not number.is_finite():
        return "NaN" if number.is_nan() else "-Infinity" if number.is_signed() else "Infinity"
    if number.is_zero():
        return "0"
    if Decimal("0.000001") <= number.copy_abs() < Decimal("1e21"):
        text = format(number, "f")
        return text.rstrip("0").rstrip(".") if "." in text else text
    mantissa, exponent = format(number, "e").split("e")
    if "." in mantissa:
        mantissa = mantissa.rstrip("0").rstrip(".")
    power = int(exponent)
    return f"{mantissa}e{power:+d}"
