/*
 * Owns runtime recognition of provider-neutral Agent errors shared by Agent Core.
 */
import type { AgentError } from './types';

/** Recognizes only the closed AgentError contract at runtime. */
export function isAgentError(value: unknown): value is AgentError {
  if (!isRecord(value)) return false;
  return isAgentErrorCode(value.code)
    && typeof value.message === 'string'
    && typeof value.retryable === 'boolean';
}

function isAgentErrorCode(value: unknown): value is AgentError['code'] {
  switch (value) {
    case 'context_failed':
    case 'model_call_failed':
    case 'tool_system_failed':
    case 'execution_limit_reached':
    case 'event_listener_failed':
    case 'internal_error':
      return true;
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
