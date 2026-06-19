// Renderer-facing session, run, and agent DTOs.
import type { JsonObject } from '../json';
import type { RuntimeError } from './runtime';

export type AgentType = 'analyst' | 'architect' | 'developer' | 'reviewer' | 'free';

export const AGENT_TYPES: AgentType[] = ['analyst', 'architect', 'developer', 'reviewer', 'free'];
export const AGENT_LABELS: Record<AgentType, string> = {
  analyst: 'Analyst',
  architect: 'Architect',
  developer: 'Developer',
  reviewer: 'Reviewer',
  free: 'Free',
};
export const AGENT_DESCRIPTIONS: Record<AgentType, string> = {
  analyst: 'Research, requirements, and problem framing',
  architect: 'Architecture, design, and tradeoff analysis',
  developer: 'Implementation and debugging',
  reviewer: 'Review, verification, and risk checks',
  free: 'General-purpose agent session',
};

export type RunStatus = 'queued' | 'running' | 'waiting_for_approval' | 'paused' | 'cancelling' | 'cancelled' | 'failed' | 'completed';
export type RunStepKind = 'model' | 'tool' | 'approval' | 'context' | 'artifact' | 'memory' | 'checkpoint' | 'final' | 'error' | 'observation' | string;
export type RunStepStatus = 'pending' | 'running' | 'waiting_for_approval' | 'succeeded' | 'failed' | 'cancelled' | 'skipped' | string;

export interface Session {
  sessionId: string;
  title: string;
  workspaceId?: string;
  workspacePath?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  summary?: string;
  metadata?: JsonObject;
}

export interface Run {
  runId: string;
  sessionId: string;
  triggerMessageId?: string;
  mode?: string;
  goal?: string;
  status: RunStatus | string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  error?: RuntimeError;
  metadata?: JsonObject;
}
