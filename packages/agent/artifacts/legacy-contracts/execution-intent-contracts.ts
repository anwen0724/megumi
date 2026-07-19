/*
 * Artifact-local execution intent contracts kept isolated from Agent Action Permissions.
 * No other module may import this file.
 */
import { z } from 'zod';
import { IsoDateTimeSchema } from './artifact-json';

export const ARTIFACT_EXECUTION_INTENTS = ['default', 'accept_edits', 'plan', 'auto'] as const;
export type ArtifactExecutionIntent = (typeof ARTIFACT_EXECUTION_INTENTS)[number];

export const EXECUTION_INTENT_SELECTION_SOURCES = [
  'user',
  'project',
  'local',
  'system',
  'intent_default',
] as const;
export type ExecutionIntentSelectionSource = (typeof EXECUTION_INTENT_SELECTION_SOURCES)[number];

export interface ExecutionIntentSnapshot {
  executionIntent: ArtifactExecutionIntent;
  source: ExecutionIntentSelectionSource;
  createdAt: string;
}

export const ArtifactExecutionIntentSchema = z.enum(ARTIFACT_EXECUTION_INTENTS);
export const ExecutionIntentSelectionSourceSchema = z.enum(EXECUTION_INTENT_SELECTION_SOURCES);

export const ExecutionIntentSnapshotSchema = z
  .object({
    executionIntent: ArtifactExecutionIntentSchema,
    source: ExecutionIntentSelectionSourceSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict() satisfies z.ZodType<ExecutionIntentSnapshot>;

export function isArtifactExecutionIntent(value: string): value is ArtifactExecutionIntent {
  return (ARTIFACT_EXECUTION_INTENTS as readonly string[]).includes(value);
}
