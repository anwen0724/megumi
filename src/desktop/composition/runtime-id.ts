// Hosts deterministic desktop runtime helper functions shared by local runtime composition pieces.
import type { AgentRuntimeResumeRequest } from '../../app';
import type { RawInput } from '../../input';
import type { JsonObject } from '../../shared';

export function createStableId(prefix: string, value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9:_-]/g, '_') || 'local';
  if (normalized.startsWith(`${prefix}_`) || normalized.startsWith(`${prefix}-`)) {
    return normalized;
  }
  return `${prefix}_${normalized}`;
}

export function titleFromInput(text: string | undefined): string {
  const trimmed = text?.trim();
  return trimmed ? trimmed.slice(0, 80) : 'New session';
}

export function numberOption(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function permissionModeOption(value: unknown): 'default' | 'plan' | 'accept_edits' | 'auto' {
  return value === 'plan' || value === 'accept_edits' || value === 'auto' ? value : 'default';
}

export function isProviderId(value: unknown): value is 'deepseek' | 'openai' | 'anthropic' {
  return value === 'deepseek' || value === 'openai' || value === 'anthropic';
}

export function resumeDecisionKind(request: AgentRuntimeResumeRequest): 'allow_once' | 'allow_for_session' | 'deny' {
  if (request.decision === 'deny') return 'deny';
  if (
    request.metadata?.decision === 'allow_for_session'
    || request.metadata?.approvalScope === 'session'
    || request.metadata?.scope === 'session'
  ) {
    return 'allow_for_session';
  }
  return 'allow_once';
}

export function isInputSourceKind(value: unknown): value is RawInput['source']['kind'] {
  return value === 'composer' || value === 'quick_action' || value === 'system' || value === 'desktop' || value === 'app';
}

export function jsonObjectOrUndefined(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

export function stringMetadata(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}
