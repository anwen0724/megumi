import type { SessionRetryReason } from '@megumi/shared/session-active-path-contracts';
import type { RuntimeError } from '@megumi/shared/runtime-errors';

export interface AutomaticModelStepRetryDecision {
  retryable: boolean;
  reason?: SessionRetryReason;
}

const NON_RETRYABLE_PATTERNS = [
  /context window|context length|maximum context|context_budget|context overflow/i,
  /insufficient_quota|billing|balance|quota exceeded|out of budget|usage limit/i,
  /permission denied|policy denied|approval rejected|user rejected/i,
  /user cancelled|user canceled|cancelled by user|canceled by user/i,
  /tool input validation|validation failed|invalid tool/i,
  /protocol violation|invalid state|schema mismatch/i,
];

const RETRY_REASON_PATTERNS: Array<[SessionRetryReason, RegExp]> = [
  ['provider_overload', /overload|overloaded/i],
  ['rate_limited', /rate.?limit|too many requests|429/i],
  ['service_unavailable', /service.?unavailable|unavailable|503/i],
  ['premature_stream_end', /premature|stream ended|message_stop/i],
  ['network_timeout', /timeout|timed out|network/i],
  ['runtime_provider_error', /provider/i],
];

export function classifyAutomaticModelStepRetry(error: RuntimeError): AutomaticModelStepRetryDecision {
  const searchable = [
    error.code,
    error.message,
    error.source,
  ].join(' ');

  if (NON_RETRYABLE_PATTERNS.some((pattern) => pattern.test(searchable))) {
    return { retryable: false };
  }

  const matchedReason = RETRY_REASON_PATTERNS.find(([, pattern]) => pattern.test(searchable))?.[0];
  if (matchedReason) {
    return {
      retryable: true,
      reason: matchedReason,
    };
  }

  if (error.retryable === false) {
    return { retryable: false };
  }

  return { retryable: false };
}

export function createAutomaticRetryBackoffMs(input: {
  attemptNumber: number;
  baseDelayMs: number;
  maxDelayMs: number;
}): number {
  const attemptNumber = Math.max(1, Math.floor(input.attemptNumber));
  const baseDelayMs = Math.max(0, Math.floor(input.baseDelayMs));
  const maxDelayMs = Math.max(0, Math.floor(input.maxDelayMs));
  const delayMs = baseDelayMs * 2 ** (attemptNumber - 1);

  return Math.min(delayMs, maxDelayMs);
}
