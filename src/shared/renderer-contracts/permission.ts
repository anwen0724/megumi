// Renderer-facing permission DTOs.
import type { JsonObject } from '../json';

export type PermissionMode = 'default' | 'accept_edits' | 'plan' | 'auto' | 'read_only' | 'auto_approve' | 'manual';
export type PermissionModeSelectionSource = 'user' | 'project' | 'local' | 'system' | 'intent_default' | 'default' | 'session';

export interface PermissionModeState {
  permissionMode: PermissionMode;
  source?: PermissionModeSelectionSource;
}

export interface PermissionSnapshotRecord {
  permissionSnapshotId: string;
  runId: string;
  permissionModeState: PermissionModeState;
  permissionLabel: string;
  createdAt: string;
  metadata?: JsonObject;
}

export const IMPLEMENTATION_PLAN_ARTIFACT_STATUSES = ['draft', 'proposed', 'accepted', 'rejected', 'superseded'] as const;
export type ImplementationPlanArtifactStatus = (typeof IMPLEMENTATION_PLAN_ARTIFACT_STATUSES)[number];

export interface ImplementationPlanArtifactRecord {
  planArtifactId: string;
  producingRunId: string;
  title: string;
  status: ImplementationPlanArtifactStatus;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  rejectedAt?: string;
  supersededAt?: string;
  supersededByPlanId?: string;
  metadata?: JsonObject;
}

export interface PermissionSnapshot {
  id: string;
  runId?: string;
  sessionId?: string;
  mode: PermissionMode | string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'default'
    || value === 'accept_edits'
    || value === 'plan'
    || value === 'auto'
    || value === 'read_only'
    || value === 'auto_approve'
    || value === 'manual';
}
