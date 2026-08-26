/*
 * Converts arbitrary runtime values into deterministic, secret-safe diagnostic content.
 */
import { createHash } from 'node:crypto';
import type { DiagnosticJsonValue } from '../diagnostic-value';
import type {
  CapturedContent,
  CaptureIssue,
  UnavailableReason,
} from './content-contract';
import { classifySecretField, redactDiagnosticText } from './secret-redaction';

const DEFAULT_INLINE_THRESHOLD_BYTES = 16 * 1024;
const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_NODES = 100_000;
const JSON_MEDIA_TYPE = 'application/json';
const TEXT_MEDIA_TYPE = 'text/plain;charset=utf-8';
const BINARY_MEDIA_TYPE = 'application/octet-stream';

export interface CaptureContentInput {
  readonly value: unknown;
  readonly mediaType?: string;
  readonly inlineThresholdBytes?: number;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

export interface CapturedContentPayload {
  readonly content: CapturedContent;
  readonly storedBytes?: Uint8Array;
}

interface CaptureState {
  readonly issues: CaptureIssue[];
  readonly ancestors: WeakSet<object>;
  readonly maxDepth: number;
  readonly maxNodes: number;
  nodesVisited: number;
}

type VisitResult =
  | { readonly status: 'captured'; readonly value: DiagnosticJsonValue }
  | { readonly status: 'unavailable'; readonly reason: UnavailableReason };

/** Safely captures supported content without invoking accessors or retaining source secrets. */
export function captureContent(input: CaptureContentInput): CapturedContentPayload {
  const binary = toBinaryBytes(input.value);
  if (binary) {
    return createStoredPayload(binary, input.mediaType ?? BINARY_MEDIA_TYPE);
  }
  if (typeof input.value === 'string' && redactDiagnosticText(input.value).entirelyRedacted) {
    return { content: { mode: 'redacted', reason: 'secret_pattern' } };
  }

  const state: CaptureState = {
    issues: [],
    ancestors: new WeakSet<object>(),
    maxDepth: input.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxNodes: input.maxNodes ?? DEFAULT_MAX_NODES,
    nodesVisited: 0,
  };
  const result = visitValue(input.value, '', 0, state);
  if (result.status === 'unavailable') {
    return { content: { mode: 'unavailable', reason: result.reason } };
  }

  try {
    const serialized = typeof result.value === 'string'
      ? result.value
      : canonicalStringify(result.value);
    const bytes = new TextEncoder().encode(serialized);
    const mediaType = input.mediaType ?? (
      typeof result.value === 'string' ? TEXT_MEDIA_TYPE : JSON_MEDIA_TYPE
    );
    const issues = state.issues.length > 0 ? state.issues : undefined;
    const contentId = hashBytes(bytes);
    const threshold = input.inlineThresholdBytes ?? DEFAULT_INLINE_THRESHOLD_BYTES;

    if (bytes.byteLength <= threshold) {
      return {
        content: {
          mode: 'inline',
          contentId,
          mediaType,
          value: result.value,
          ...(issues ? { issues } : {}),
        },
      };
    }

    return {
      content: {
        mode: 'stored',
        contentId,
        mediaType,
        byteLength: bytes.byteLength,
        ...(issues ? { issues } : {}),
      },
      storedBytes: bytes,
    };
  } catch {
    return { content: { mode: 'unavailable', reason: 'serialization_failed' } };
  }
}

/** Returns the same safe canonical identity used by Captured Content, without persisting bytes. */
export function createContentDigest(value: unknown): string | undefined {
  try {
    const captured = captureContent({ value }).content;
    return captured.mode === 'inline' || captured.mode === 'stored'
      ? captured.contentId
      : undefined;
  } catch {
    return undefined;
  }
}

/** Recursively narrows one runtime value while sharing bounded traversal state. */
function visitValue(
  value: unknown,
  path: string,
  depth: number,
  state: CaptureState,
): VisitResult {
  state.nodesVisited += 1;
  if (state.nodesVisited > state.maxNodes || depth > state.maxDepth) {
    return { status: 'unavailable', reason: 'serialization_failed' };
  }

  if (value === null || typeof value === 'boolean') {
    return { status: 'captured', value };
  }
  if (typeof value === 'string') {
    const redacted = redactDiagnosticText(value);
    if (redacted.changed) {
      state.issues.push({ path, kind: 'redacted', reason: 'secret_pattern' });
    }
    return { status: 'captured', value: redacted.value };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { status: 'captured', value }
      : { status: 'unavailable', reason: 'unsupported_value' };
  }
  if (typeof value !== 'object') {
    return { status: 'unavailable', reason: 'unsupported_value' };
  }

  if (state.ancestors.has(value)) {
    return { status: 'unavailable', reason: 'circular_reference' };
  }

  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return { status: 'unavailable', reason: 'unsafe_property_access' };
  }

  const arrayValue = Array.isArray(value);
  if (!arrayValue && prototype !== Object.prototype && prototype !== null) {
    return { status: 'unavailable', reason: 'unsupported_value' };
  }

  state.ancestors.add(value);
  try {
    return arrayValue
      ? visitArray(descriptors, path, depth, state)
      : visitObject(descriptors, path, depth, state);
  } finally {
    state.ancestors.delete(value);
  }
}

/** Copies array data descriptors without observing getters or sparse slots. */
function visitArray(
  descriptors: PropertyDescriptorMap,
  path: string,
  depth: number,
  state: CaptureState,
): VisitResult {
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && 'value' in lengthDescriptor
    && typeof lengthDescriptor.value === 'number'
    ? lengthDescriptor.value
    : 0;
  if (length > state.maxNodes) {
    return { status: 'unavailable', reason: 'serialization_failed' };
  }
  const captured: DiagnosticJsonValue[] = [];

  for (let index = 0; index < length; index += 1) {
    const itemPath = appendJsonPointer(path, String(index));
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor)) {
      captured.push(null);
      if (descriptor) {
        state.issues.push({
          path: itemPath,
          kind: 'unavailable',
          reason: 'unsafe_property_access',
        });
      }
      continue;
    }
    captured.push(captureNestedValue(descriptor.value, itemPath, depth + 1, state));
  }

  return { status: 'captured', value: captured };
}

/** Copies sorted own data properties and replaces unsafe children with null. */
function visitObject(
  descriptors: PropertyDescriptorMap,
  path: string,
  depth: number,
  state: CaptureState,
): VisitResult {
  const captured: Record<string, DiagnosticJsonValue> = {};
  const keys = Object.keys(descriptors).sort();
  const symbolCount = Reflect.ownKeys(descriptors).filter((key) => typeof key === 'symbol').length;
  if (keys.length + symbolCount > state.maxNodes) {
    return { status: 'unavailable', reason: 'serialization_failed' };
  }
  for (const key of keys) {
    const propertyPath = appendJsonPointer(path, key);
    const secretReason = classifySecretField(key);
    if (secretReason) {
      captured[key] = null;
      state.issues.push({ path: propertyPath, kind: 'redacted', reason: secretReason });
      continue;
    }

    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor)) {
      captured[key] = null;
      state.issues.push({
        path: propertyPath,
        kind: 'unavailable',
        reason: 'unsafe_property_access',
      });
      continue;
    }
    captured[key] = captureNestedValue(descriptor.value, propertyPath, depth + 1, state);
  }

  for (let index = 0; index < symbolCount; index += 1) {
    state.issues.push({
      path: appendJsonPointer(path, `<symbol:${index}>`),
      kind: 'unavailable',
      reason: 'unsupported_value',
    });
  }

  return { status: 'captured', value: captured };
}

function captureNestedValue(
  value: unknown,
  path: string,
  depth: number,
  state: CaptureState,
): DiagnosticJsonValue {
  const result = visitValue(value, path, depth, state);
  if (result.status === 'captured') {
    return result.value;
  }
  state.issues.push({ path, kind: 'unavailable', reason: result.reason });
  return null;
}

function appendJsonPointer(path: string, segment: string): string {
  const escaped = segment.replace(/~/g, '~0').replace(/\//g, '~1');
  return `${path}/${escaped}`;
}

function canonicalStringify(value: DiagnosticJsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (isDiagnosticArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  const entries = Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalStringify(value[key] ?? null)}`
  ));
  return `{${entries.join(',')}}`;
}

function isDiagnosticArray(
  value: DiagnosticJsonValue,
): value is readonly DiagnosticJsonValue[] {
  return Array.isArray(value);
}

function toBinaryBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  return undefined;
}

function createStoredPayload(bytes: Uint8Array, mediaType: string): CapturedContentPayload {
  const contentId = hashBytes(bytes);
  return {
    content: { mode: 'stored', contentId, mediaType, byteLength: bytes.byteLength },
    storedBytes: bytes,
  };
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
