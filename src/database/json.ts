// Centralizes JSON serialization for SQLite row mapping.
import { RowMappingError } from './errors';

export function encodeJson(value: unknown | undefined): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export function decodeJson<T>(value: string | null | undefined): T | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  return JSON.parse(value) as T;
}

export function decodeJsonField<T>(input: {
  value: string | null | undefined;
  table: string;
  column: string;
  rowId: string;
}): T | undefined {
  try {
    return decodeJson<T>(input.value);
  } catch (error) {
    throw new RowMappingError(
      `Row mapping failed for ${input.table}.${input.column} on row ${input.rowId}`,
      {
        table: input.table,
        column: input.column,
        rowId: input.rowId,
        cause: error,
      },
    );
  }
}
