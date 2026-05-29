import { z } from 'zod';
import type { IsoDateTime } from './ids';
import type { ModelInputContextSourceRef } from './model-input-context-contracts';
import { ModelInputContextSourceRefSchema } from './model-input-context-contracts';
import { IsoDateTimeSchema } from './runtime-validation';

const IdSchema = z.string().min(1).max(128);
const NonEmptyTextSchema = z.string().min(1);

export const SESSION_HISTORY_ENTRY_ROLES = ['user', 'assistant'] as const;
export type SessionHistoryEntryRole = (typeof SESSION_HISTORY_ENTRY_ROLES)[number];

export const SESSION_HISTORY_ENTRY_STATUSES = [
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export type SessionHistoryEntryStatus = (typeof SESSION_HISTORY_ENTRY_STATUSES)[number];

export const SESSION_RUNTIME_FACT_KINDS = [
  'tool_result',
  'approval',
  'run_failed',
  'run_cancelled',
  'run_interrupted',
  'step_failed',
  'tool_error',
  'other',
] as const;
export type SessionRuntimeFactKind = (typeof SESSION_RUNTIME_FACT_KINDS)[number];

export const SESSION_RUNTIME_FACT_SEVERITIES = ['info', 'warning', 'error'] as const;
export type SessionRuntimeFactSeverity = (typeof SESSION_RUNTIME_FACT_SEVERITIES)[number];

export const SESSION_SUMMARY_ENTRY_KINDS = ['explicit', 'compaction'] as const;
export type SessionSummaryEntryKind = (typeof SESSION_SUMMARY_ENTRY_KINDS)[number];

export const SessionHistoryEntrySchema = z
  .object({
    entryId: IdSchema,
    role: z.enum(SESSION_HISTORY_ENTRY_ROLES),
    text: NonEmptyTextSchema,
    status: z.enum(SESSION_HISTORY_ENTRY_STATUSES),
    sourceRef: ModelInputContextSourceRefSchema,
    createdAt: IsoDateTimeSchema.optional(),
    completedAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export interface SessionHistoryEntry {
  entryId: string;
  role: SessionHistoryEntryRole;
  text: string;
  status: SessionHistoryEntryStatus;
  sourceRef: ModelInputContextSourceRef;
  createdAt?: IsoDateTime;
  completedAt?: IsoDateTime;
}

export const SessionRuntimeFactSchema = z
  .object({
    factId: IdSchema,
    factKind: z.enum(SESSION_RUNTIME_FACT_KINDS),
    text: NonEmptyTextSchema,
    sourceRef: ModelInputContextSourceRefSchema,
    severity: z.enum(SESSION_RUNTIME_FACT_SEVERITIES).optional(),
    createdAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export interface SessionRuntimeFact {
  factId: string;
  factKind: SessionRuntimeFactKind;
  text: string;
  sourceRef: ModelInputContextSourceRef;
  severity?: SessionRuntimeFactSeverity;
  createdAt?: IsoDateTime;
}

export const SessionSummaryEntrySchema = z
  .object({
    summaryId: IdSchema,
    summaryKind: z.enum(SESSION_SUMMARY_ENTRY_KINDS).optional(),
    text: NonEmptyTextSchema,
    sourceRef: ModelInputContextSourceRefSchema,
    createdAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export interface SessionSummaryEntry {
  summaryId: string;
  summaryKind?: SessionSummaryEntryKind;
  text: string;
  sourceRef: ModelInputContextSourceRef;
  createdAt?: IsoDateTime;
}

export const SessionContextInputSchema = z
  .object({
    historyEntries: z.array(SessionHistoryEntrySchema).optional(),
    runtimeFacts: z.array(SessionRuntimeFactSchema).optional(),
    summaryEntries: z.array(SessionSummaryEntrySchema).optional(),
    maxHistoryEntries: z.number().int().positive().optional(),
  })
  .strict();

export interface SessionContextInput {
  historyEntries?: SessionHistoryEntry[];
  runtimeFacts?: SessionRuntimeFact[];
  summaryEntries?: SessionSummaryEntry[];
  maxHistoryEntries?: number;
}
