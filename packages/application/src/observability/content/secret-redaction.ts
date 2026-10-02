/*
 * Owns deterministic secret-field classification and text redaction before content hashing.
 */
import type { RedactionReason } from './content-contract';
import type { DiagnosticError } from '../diagnostic-error';
import type { DiagnosticJsonValue } from '../diagnostic-value';

const REDACTED = '[redacted]';
const AUTHORIZATION_FIELD_PATTERN = /authorization/i;
const COOKIE_FIELD_PATTERN = /cookie/i;
const PASSWORD_FIELD_PATTERN = /password/i;
const TOKEN_FIELD_NAMES = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authtoken',
  'bearertoken',
  'sessiontoken',
  'apitoken',
]);

const SECRET_TEXT_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/g,
  /\bsk-[A-Za-z0-9._-]{8,}\b/g,
  /\b([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password))=([^&\s]+)/gi,
  /\b(token|secret|password):\s*([^,\s]+)/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** Returns the stable diagnostic reason when an object field must not be captured. */
export function classifySecretField(fieldName: string): RedactionReason | undefined {
  if (AUTHORIZATION_FIELD_PATTERN.test(fieldName)) {
    return 'authorization_header';
  }
  if (COOKIE_FIELD_PATTERN.test(fieldName)) {
    return 'cookie';
  }
  if (PASSWORD_FIELD_PATTERN.test(fieldName)) {
    return 'password';
  }
  const compactName = fieldName.replace(/[-_\s]/g, '').toLowerCase();
  if (
    compactName.endsWith('apikey')
    || compactName.endsWith('clientsecret')
    || compactName.endsWith('privatekey')
    || compactName === 'secret'
    || compactName === 'credential'
    || compactName === 'credentials'
    || TOKEN_FIELD_NAMES.has(compactName)
  ) {
    return 'secret_field';
  }
  return undefined;
}

export interface RedactedDiagnosticText {
  readonly value: string;
  readonly changed: boolean;
  readonly entirelyRedacted: boolean;
}

/** Replaces known credential shapes without exposing the matched text in diagnostics. */
export function redactDiagnosticText(value: string): RedactedDiagnosticText {
  let changed = false;
  const redacted = SECRET_TEXT_PATTERNS.reduce((current, pattern) => current.replace(
    pattern,
    (match, fieldName: string | undefined) => {
      changed = true;
      return typeof fieldName === 'string' ? `${fieldName}=${REDACTED}` : REDACTED;
    },
  ), value);

  return {
    value: redacted,
    changed,
    entirelyRedacted: changed && redacted.trim() === REDACTED,
  };
}

/** Removes known credential fields and patterns from already JSON-safe Runtime Log data. */
export function redactDiagnosticJsonValue(value: DiagnosticJsonValue): DiagnosticJsonValue {
  if (typeof value === 'string') {
    return redactDiagnosticText(value).value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (isDiagnosticArray(value)) {
    return value.map((item) => redactDiagnosticJsonValue(item));
  }

  const redacted: Record<string, DiagnosticJsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = classifySecretField(key)
      ? REDACTED
      : redactDiagnosticJsonValue(item);
  }
  return redacted;
}

/** Removes credential patterns from a bounded DiagnosticError tree. */
export function redactDiagnosticError(error: DiagnosticError): DiagnosticError {
  return {
    name: redactDiagnosticText(error.name).value,
    message: redactDiagnosticText(error.message).value,
    ...(error.code ? { code: redactDiagnosticText(error.code).value } : {}),
    ...(error.stack ? { stack: redactDiagnosticText(error.stack).value } : {}),
    ...(error.cause ? { cause: redactDiagnosticError(error.cause) } : {}),
  };
}

function isDiagnosticArray(
  value: DiagnosticJsonValue,
): value is readonly DiagnosticJsonValue[] {
  return Array.isArray(value);
}
