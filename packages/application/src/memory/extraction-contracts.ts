/* Contracts for the extraction stage; completion does not imply knowledge consolidation. */
import type { Api, Context, Model, ModelsSimpleStreamOptions, AssistantMessage } from '@megumi/ai';
import type { SettingsConfiguration } from '../settings/settings-schema';
import type { ExtractionCoverage } from './extraction-input';

export type ExtractionJobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'superseded';
export interface ExtractionError {
  readonly code: string;
  readonly message: string;
}
export interface ExtractionOutput {
  readonly rawMemory: string;
  readonly rolloutSummary: string;
  readonly rolloutSlug: string;
}
export interface ExtractionJob {
  readonly jobId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly sourceVersion: string;
  readonly status: ExtractionJobStatus;
  readonly attempt: number;
  readonly retryGroupId: string;
  readonly retryOfJobId?: string;
  readonly retryAt?: string;
  readonly error?: ExtractionError;
  readonly result?: {
    readonly coverage: ExtractionCoverage;
    readonly durationMs: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}
export interface SavedExtraction extends ExtractionOutput {
  readonly sessionId: string;
  readonly sourceVersion: string;
  readonly coverage: ExtractionCoverage;
  readonly sourceRef: string;
  readonly extractedAt: string;
}
export interface ExtractionModel {
  readonly model: Model<Api>;
  readonly secrets: readonly string[];
  complete(context: Context, options: ModelsSimpleStreamOptions): Promise<AssistantMessage>;
}
export type MemoryConfiguration = SettingsConfiguration['memory'];
export interface ExtractionSourceFailure {
  readonly sessionId: string;
  readonly error: ExtractionError;
}
export type ExtractionResult = 'extracted' | 'unchanged' | 'partial' | 'failed' | 'cancelled';
export type ExtractionBatchResult =
  | {
      readonly status: 'completed';
      readonly stage: 'extract';
      readonly runId: string;
      readonly result: ExtractionResult;
      readonly jobs: readonly ExtractionJob[];
      readonly sourceFailures: readonly ExtractionSourceFailure[];
    }
  | {
      readonly status: 'skipped';
      readonly reason: 'disabled' | 'unchanged' | 'stopped';
    }
  | {
      readonly status: 'failed';
      readonly error: ExtractionError;
    };

export interface MemoryExtraction {
  /** Settles only source extraction. No final memory files are produced here. */
  extract(request?: {
    readonly triggerSessionId?: string;
    readonly failedJobId?: string;
    readonly signal?: AbortSignal;
    readonly onProgress?: (runId: string) => void;
  }): Promise<ExtractionBatchResult>;
  getJob(jobId: string): ExtractionJob | undefined;
  listJobs(runId: string): readonly ExtractionJob[];
  getExtraction(sessionId: string): SavedExtraction | undefined;
  cancelActive(): Promise<void>;
  shutdown(): Promise<void>;
}
