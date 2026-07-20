/* Builds canonical non-sensitive hashes for every Evaluation comparability dimension. */
import { createHash } from 'node:crypto';
import type { EvaluationExecutionFingerprint } from './evaluation-contracts';

export interface CreateEvaluationFingerprintInput {
  sourceRevision: string;
  sourceDirty: boolean;
  evaluationCase: unknown;
  fixture?: unknown;
  suite: unknown;
  target: unknown;
  executionProfile: unknown;
  relevantSettings: unknown;
  toolCatalog: unknown;
  skillCatalog: unknown;
  instructionSources?: unknown;
  graderConfig: unknown;
}

export function createEvaluationFingerprint(input: CreateEvaluationFingerprintInput): EvaluationExecutionFingerprint {
  return {
    sourceRevision: input.sourceRevision,
    sourceDirty: input.sourceDirty,
    caseDigest: canonicalDigest(input.evaluationCase),
    ...(input.fixture === undefined ? {} : { fixtureDigest: canonicalDigest(input.fixture) }),
    suiteDigest: canonicalDigest(input.suite),
    targetDigest: canonicalDigest(input.target),
    executionProfileDigest: canonicalDigest(input.executionProfile),
    relevantSettingsDigest: canonicalDigest(removeSensitiveValues(input.relevantSettings)),
    toolCatalogDigest: canonicalDigest(input.toolCatalog),
    skillCatalogDigest: canonicalDigest(input.skillCatalog),
    ...(input.instructionSources === undefined
      ? {}
      : { instructionSourcesDigest: canonicalDigest(input.instructionSources) }),
    graderConfigDigest: canonicalDigest(input.graderConfig),
  };
}

export function canonicalDigest(value: unknown): string {
  return createHash('sha256').update(canonicalSerialize(value), 'utf8').digest('hex');
}

export function canonicalSerialize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return value;
}

function removeSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeSensitiveValues);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(?:api.?key|credential|secret|token|password)/i.test(key))
    .map(([key, item]) => [key, removeSensitiveValues(item)]));
}
