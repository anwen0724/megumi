/*
 * Defines Product-selected defaults that are injected into owning modules.
 * It does not reimplement the policies enforced by those modules.
 */
import type { RecentEventBufferOptions } from '@megumi/events';
import type { RunPolicy } from '@megumi/engine';
import type { Settings } from '@megumi/settings';

export const PRODUCT_RECENT_EVENT_BUFFER = {
  maxSessions: 64,
  maxEventsPerSession: 2_048,
} satisfies RecentEventBufferOptions;

export const PRODUCT_RUN_POLICY = {
  maxModelCallsPerRun: 80,
  maxToolRoundsPerRun: 50,
  maxToolCallsPerModelCall: 32,
  maxToolCallsPerRun: 256,
  maxConcurrentToolExecutions: 4,
  modelCallTimeoutMs: 120_000,
  toolExecutionTimeoutMs: 120_000,
  cancellationTimeoutMs: 10_000,
  maxModelCallAttempts: 3,
  modelRetryDelayMs: 1_000,
  maxToolExecutionsPerCall: 1,
  maxContextOverflowRecoveries: 1,
  providerRequestMaxRetries: 2,
  providerRequestMaxRetryDelayMs: 60_000,
  terminalRunRetentionMs: 300_000,
} satisfies RunPolicy;

/** Converts the host platform identifier into the stable value shown to models. */
export function resolveModelVisibleOperatingSystem(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform;
}

/** Resolves the UI percentage without making Product the owner of compaction policy. */
export function resolveAutoCompactPercent(settings: Settings): number {
  const resolved = settings.resolve();
  const ratio = resolved.status === 'ok'
    ? resolved.settings.context.compaction_threshold_ratio
    : 0.8;
  return Math.round((ratio ?? 0.8) * 100);
}
