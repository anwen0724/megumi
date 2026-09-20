"""Local JSON Schema checks and provider strict conversion have separate responsibilities."""

from collections.abc import Iterator

from jsonschema import Draft7Validator
from jsonschema.exceptions import SchemaError, ValidationError
from referencing import Registry
from referencing.exceptions import Unresolvable

from app.ai.errors import ToolValidationError
from app.ai.messages import JSONValue


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
