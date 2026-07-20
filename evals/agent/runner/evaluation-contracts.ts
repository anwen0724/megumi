/* Defines immutable execution identity, lifecycle status, and bounded evidence. */
import type { RuntimeEvent } from '@megumi/product/runtime-events';

export type EvaluationExecutionStatus = 'completed' | 'setup_failed' | 'runner_failed';

export interface EvaluationExecutionFingerprint {
  sourceRevision: string;
  sourceDirty: boolean;
  caseDigest: string;
  fixtureDigest?: string;
  suiteDigest: string;
  targetDigest: string;
  executionProfileDigest: string;
  relevantSettingsDigest: string;
  toolCatalogDigest: string;
  skillCatalogDigest: string;
  instructionSourcesDigest?: string;
  graderConfigDigest: string;
}

export interface EvaluationExecution {
  executionId: string;
  suiteId: string;
  caseId: string;
  targetId: string;
  executionProfileId: string;
  repetition: number;
  startedAt: string;
  completedAt?: string;
  status: EvaluationExecutionStatus;
  fingerprint?: EvaluationExecutionFingerprint;
  correlation?: {
    workspaceId?: string;
    sessionId?: string;
    runId?: string;
  };
  diagnostics: EvaluationDiagnostic[];
}

export interface EvaluationDiagnostic {
  code: string;
  message: string;
  source: 'setup' | 'runner' | 'observability' | 'cleanup';
}

export interface EvaluationSessionEvidence {
  sessionId: string;
  messages: unknown[];
  timeline: unknown[];
  finalReply?: string;
  complete: boolean;
}

export interface EvaluationWorkspaceFileEvidence {
  path: string;
  exists: boolean;
  content?: string;
  initialContent?: string;
  initialExists?: boolean;
  digest?: string;
  initialDigest?: string;
  truncated?: boolean;
  error?: string;
}

export interface EvaluationEvidence {
  session: EvaluationSessionEvidence;
  workspace: {
    files: EvaluationWorkspaceFileEvidence[];
    complete: boolean;
  };
  runtimeEvents: {
    events: RuntimeEvent[];
    complete: boolean;
    truncated: boolean;
  };
  diagnostics?: {
    available: boolean;
    records?: unknown[];
    error?: string;
  };
}
