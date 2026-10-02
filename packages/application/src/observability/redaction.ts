/*
 * Preserves the legacy Runtime Log redaction API through safe descriptor-only traversal.
 */
import type { DiagnosticJsonValue } from './diagnostic-value';
import { classifySecretField } from './content/secret-redaction';

export interface RedactionOptions {
  readonly visiblePrefix?: number;
  readonly visibleSuffix?: number;
}

const REDACTED = '[redacted]';
const DROP_KEY_PATTERN = /^(stack|cause)$/i;
const RAW_RUNTIME_FIELD_PATTERN = /^raw.*(?:body|header|output)$/i;
const MAX_RUNTIME_DEPTH = 32;
const MAX_RUNTIME_NODES = 10_000;

const RUNTIME_SECRET_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly replacement: string;
}[] = [
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/g,
    replacement: `Bearer ${REDACTED}`,
  },
  {
    pattern: /\bsk-[A-Za-z0-9._-]{8,}\b/g,
    replacement: REDACTED,
  },
  {
    pattern: /\b(apiKey|api_key|token|secret|password)=([^&\s]+)/gi,
    replacement: `$1=${REDACTED}`,
  },
  {
    pattern: /\b(token|secret|password):\s*([^,\s]+)/gi,
    replacement: `$1: ${REDACTED}`,
  },
];

interface RuntimeRedactionState {
  readonly ancestors: WeakSet<object>;
  nodesVisited: number;
}

/** Redacts a full secret while optionally retaining a bounded identifying prefix and suffix. */
export function redactSecret(value: string, options: RedactionOptions = {}): string {
  const visiblePrefix = Math.max(0, options.visiblePrefix ?? 0);
  const visibleSuffix = Math.max(0, options.visibleSuffix ?? 0);

  if (visiblePrefix === 0 && visibleSuffix === 0) {
    return REDACTED;
  }
  if (value.length <= visiblePrefix + visibleSuffix) {
    return REDACTED;
  }

  const prefix = visiblePrefix > 0 ? value.slice(0, visiblePrefix) : '';
  const suffix = visibleSuffix > 0 ? value.slice(value.length - visibleSuffix) : '';
  return `${prefix}...${REDACTED}...${suffix}`;
}

/** Removes known credential shapes from one display-safe Runtime Log message. */
export function redactRuntimeMessage(message: string): string {
  return RUNTIME_SECRET_PATTERNS.reduce(
    (current, rule) => current.replace(rule.pattern, rule.replacement),
    message,
  );
}

/** Produces bounded JSON-safe runtime data without invoking getters or proxy values. */
export function redactRuntimeValue(value: unknown): DiagnosticJsonValue {
  return visitRuntimeValue(value, 0, {
    ancestors: new WeakSet<object>(),
    nodesVisited: 0,
  });
}

/** Redacts one Runtime Log details object while preserving its JSON object shape. */
export function redactRuntimeDetails(
  details: Record<string, unknown> | undefined,
): { readonly [key: string]: DiagnosticJsonValue } | undefined {
  if (!details) {
    return undefined;
  }
  const redacted = redactRuntimeValue(details);
  return isDiagnosticObject(redacted) ? redacted : {};
}

/** Retains the legacy object-redaction entry point until the old writer is removed. */
export function redactObjectSecrets(
  value: Record<string, unknown>,
): { readonly [key: string]: DiagnosticJsonValue } {
  return redactRuntimeDetails(value) ?? {};
}

/** Recursively copies only own data descriptors into a bounded diagnostic JSON value. */
function visitRuntimeValue(
  value: unknown,
  depth: number,
  state: RuntimeRedactionState,
): DiagnosticJsonValue {
  state.nodesVisited += 1;
  if (depth > MAX_RUNTIME_DEPTH || state.nodesVisited > MAX_RUNTIME_NODES) {
    return null;
  }
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return redactRuntimeMessage(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'object' || state.ancestors.has(value)) {
    return null;
  }

  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const isArray = Array.isArray(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    return null;
  }

  state.ancestors.add(value);
  try {
    return isArray
      ? redactRuntimeArray(descriptors, depth, state)
      : redactRuntimeObject(descriptors, depth, state);
  } finally {
    state.ancestors.delete(value);
  }
}

/** Copies runtime array elements without observing accessors or sparse slots. */
function redactRuntimeArray(
  descriptors: PropertyDescriptorMap,
  depth: number,
  state: RuntimeRedactionState,
): DiagnosticJsonValue[] {
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && 'value' in lengthDescriptor
    && typeof lengthDescriptor.value === 'number'
    ? Math.min(lengthDescriptor.value, MAX_RUNTIME_NODES)
    : 0;
  const result: DiagnosticJsonValue[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    result.push(descriptor && 'value' in descriptor
      ? visitRuntimeValue(descriptor.value, depth + 1, state)
      : null);
  }
  return result;
}

/** Redacts secret fields and omits stack/cause while copying safe runtime properties. */
function redactRuntimeObject(
  descriptors: PropertyDescriptorMap,
  depth: number,
  state: RuntimeRedactionState,
): { readonly [key: string]: DiagnosticJsonValue } {
  const result: Record<string, DiagnosticJsonValue> = {};
  for (const key of Object.keys(descriptors)) {
    if (DROP_KEY_PATTERN.test(key)) {
      continue;
    }
    if (classifySecretField(key) || RAW_RUNTIME_FIELD_PATTERN.test(key)) {
      result[key] = REDACTED;
      continue;
    }
    const descriptor = descriptors[key];
    result[key] = descriptor && 'value' in descriptor
      ? visitRuntimeValue(descriptor.value, depth + 1, state)
      : null;
  }
  return result;
}

function isDiagnosticObject(
  value: DiagnosticJsonValue,
): value is { readonly [key: string]: DiagnosticJsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
