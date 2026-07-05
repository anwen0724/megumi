/*
 * Legacy runtime contracts kept inside the artifacts module until artifacts is refactored.
 * No other module may import this file.
 */
import type {
  ArtifactContentStorage,
  ArtifactContentType,
  ArtifactKind,
  ArtifactStatus,
} from './artifact-contracts';
import type { JsonObject } from './artifact-json';

export interface RuntimeError {
  code: string;
  message: string;
  severity?: 'info' | 'warning' | 'error';
  source?: string;
  retryable?: boolean;
  details?: JsonObject;
}

export interface RunAction {
  actionId: string;
  runId: string;
  stepId: string;
  kind: string;
  status: string;
  requestedAt: string;
  completedAt?: string;
  inputPreview?: JsonObject;
  error?: RuntimeError;
  metadata?: JsonObject;
}

export interface RunObservation {
  observationId: string;
  runId: string;
  stepId?: string;
  actionId?: string;
  source: string;
  kind: string;
  receivedAt: string;
  summary?: string;
  dataRef?: string;
  error?: RuntimeError;
  metadata?: JsonObject;
}

export interface ArtifactVersionCreatedPayload {
  artifactId: string;
  artifactVersionId: string;
  versionNumber: number;
  contentType: ArtifactContentType;
  textPreview: string;
}

export interface ArtifactReferencedPayload {
  artifactId: string;
  artifactVersionId?: string;
  referencedByKind: 'run' | 'step' | 'artifact' | 'message';
  referencedById: string;
}

export interface ArtifactContentWriteFailedPayload {
  artifactId?: string;
  artifactVersionId?: string;
  storage: ArtifactContentStorage;
  error: RuntimeError;
}

export interface ArtifactCreatedPayload {
  artifactId: string;
  artifactVersionId?: string;
  kind: ArtifactKind;
  title: string;
  status: ArtifactStatus;
}
