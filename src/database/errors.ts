// Defines persistence-layer errors without deciding business recovery behavior.
export type DatabaseErrorKind =
  | 'migration'
  | 'connection'
  | 'constraint'
  | 'transaction'
  | 'row_mapping'
  | 'query';

export interface DatabaseErrorDetails {
  table?: string;
  column?: string;
  rowId?: string;
  cause?: unknown;
}

export class DatabaseError extends Error {
  constructor(
    readonly kind: DatabaseErrorKind,
    message: string,
    readonly details: DatabaseErrorDetails = {},
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class RowMappingError extends DatabaseError {
  constructor(message: string, details: DatabaseErrorDetails = {}) {
    super('row_mapping', message, details);
    this.name = 'RowMappingError';
  }
}
