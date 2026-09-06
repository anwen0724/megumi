/* Defines versioned continuous evidence independently of semantic review judgments. */
import { z } from 'zod';
import { DiscoveryStateSchema } from '@megumi/discovery';
import { ObservabilityTraceMeasurementsSchema } from '@megumi/product-host/host';
import { PreferenceSequenceStepSchema, StableEvaluationIdSchema } from './evaluation-dataset';

export const SequenceTraceSchema = z.object({
  traceId: z.string(), kind: z.enum(['preference_learning', 'recommendation']),
  measurements: ObservabilityTraceMeasurementsSchema.nullable(),
  contexts: z.array(z.unknown()), issues: z.array(z.string()),
}).strict();
export const PreferenceExperimentSchema = z.object({
  arm: z.enum(['learned', 'omitted']), checkpointId: StableEvaluationIdSchema,
  sharedStateDigest: z.string(), modelConfigDigest: z.string(),
  initialState: DiscoveryStateSchema, finalState: DiscoveryStateSchema,
  clock: z.string(), configuration: z.record(z.unknown()), inputSummary: z.array(z.unknown()),
  omittedLearnedIds: z.array(z.string()), configurationDifferences: z.array(z.string()),
  result: z.unknown(), traces: z.array(SequenceTraceSchema), issues: z.array(z.string()),
}).strict();
export const PreferenceSequenceRecordSchema = z.object({
  schemaVersion: z.literal(3), steps: z.array(z.object({
    stepId: StableEvaluationIdSchema, input: PreferenceSequenceStepSchema,
    startedAt: z.string(), endedAt: z.string(), operationResult: z.unknown(),
    initialState: DiscoveryStateSchema, finalState: DiscoveryStateSchema,
    traces: z.array(SequenceTraceSchema), experiments: z.array(PreferenceExperimentSchema), issues: z.array(z.string()),
  }).strict()),
}).strict();
export type PreferenceSequenceRecord = z.infer<typeof PreferenceSequenceRecordSchema>;
export type PreferenceExperiment = z.infer<typeof PreferenceExperimentSchema>;
export type SequenceTrace = z.infer<typeof SequenceTraceSchema>;
