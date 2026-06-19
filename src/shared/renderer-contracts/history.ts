// Defines renderer-facing history and recovery DTOs without exposing owner module internals.
import type { JsonObject, JsonValue } from '../json';

export interface RendererSessionSummaryDto {
  id: string;
  title: string;
  status: string;
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: JsonObject;
}

export interface RendererTimelineMessageDto {
  messageId: string;
  sessionId: string;
  role: string;
  content: JsonValue;
  createdAt: string;
  metadata?: JsonObject;
}

export interface RendererRunSummaryDto {
  runId: string;
  sessionId: string;
  sourceEntryId: string;
  inputSummary: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  error?: JsonObject;
  metadata?: JsonObject;
}

export interface RendererSourceEntryDto {
  sourceEntryId: string;
  parentId?: string;
  kind: string;
  ref: JsonValue;
  createdAt: string;
  metadata?: JsonObject;
}

export interface RendererBranchDraftDto {
  branchMarkerId: string;
  sessionId: string;
  sourceMessageId: string;
  seedText: string;
  label: string;
  intent: 'branch' | 'rerun';
  createdAt: string;
}

export interface RendererTimelineHydrationDto {
  sessionId: string;
  messages: RendererTimelineMessageDto[];
  runs: RendererRunSummaryDto[];
  activePath: RendererSourceEntryDto[];
  diagnostics: Array<{ code: string; message: string; messageId?: string }>;
}

export interface RendererRuntimeEventHistoryDto {
  eventId: string;
  sequence: number;
  type: string;
  runId: string;
  sessionId?: string;
  workspaceId?: string;
  occurredAt: string;
  payload: JsonObject;
}

export interface RendererRecoverableRunDto {
  runId: string;
  sessionId: string;
  status: 'waiting_for_approval' | 'failed' | 'cancelled' | 'running' | 'queued';
  reason: 'waiting_for_approval' | 'failed' | 'cancelled' | 'interrupted' | 'cancelling';
  title?: string;
  preview?: string;
  workspaceId?: string;
  metadata?: JsonObject;
}
