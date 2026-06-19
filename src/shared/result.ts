// Defines a small result envelope used by src modules without binding to IPC.
import { type MegumiError } from './errors';

export interface Success<TValue> {
  ok: true;
  value: TValue;
}

export interface Failure<TError extends MegumiError = MegumiError> {
  ok: false;
  error: TError;
}

export type Result<TValue, TError extends MegumiError = MegumiError> =
  | Success<TValue>
  | Failure<TError>;

export function ok<TValue>(value: TValue): Success<TValue> {
  return {
    ok: true,
    value,
  };
}

export function fail<TError extends MegumiError>(error: TError): Failure<TError> {
  return {
    ok: false,
    error,
  };
}

export function isSuccess<TValue, TError extends MegumiError>(
  result: Result<TValue, TError>,
): result is Success<TValue> {
  return result.ok;
}

export function isFailure<TValue, TError extends MegumiError>(
  result: Result<TValue, TError>,
): result is Failure<TError> {
  return !result.ok;
}

export function mapResult<TValue, TNextValue, TError extends MegumiError>(
  result: Result<TValue, TError>,
  mapValue: (value: TValue) => TNextValue,
): Result<TNextValue, TError> {
  if (!result.ok) {
    return result;
  }

  return ok(mapValue(result.value));
}

export function unwrapResult<TValue, TError extends MegumiError>(
  result: Result<TValue, TError>,
): TValue {
  if (result.ok) {
    return result.value;
  }

  throw new Error(result.error.message);
}
