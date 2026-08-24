/*
 * Defines application defaults injected by concrete Host composition roots.
 * It does not reimplement the policies enforced by those modules.
 */
import type { RecentEventBufferOptions } from '@megumi/events';
import type { DiscoveryAgentPolicy } from '@megumi/discovery';
import type { Settings } from '@megumi/settings';

export const PRODUCT_RECENT_EVENT_BUFFER = {
  maxSessions: 64,
  maxEventsPerSession: 2_048,
} satisfies RecentEventBufferOptions;

/** The Discovery Agent execution policy the Host compositions inject. */
export const PRODUCT_EXECUTION_POLICY = {
  maxModelCallsPerExecution: 80,
  maxToolRoundsPerExecution: 50,
  maxToolCallsPerModelCall: 32,
  maxToolCallsPerExecution: 256,
  maxConcurrentToolExecutions: 4,
  modelCallTimeoutMs: 120_000,
  toolExecutionTimeoutMs: 120_000,
  maxModelCallAttempts: 3,
  modelRetryDelayMs: 1_000,
  maxContextOverflowRecoveries: 1,
  providerRequestMaxRetries: 2,
  providerRequestMaxRetryDelayMs: 60_000,
} satisfies DiscoveryAgentPolicy;

/** The terminal execution retention budget handed to the Execution Registry. */
export const PRODUCT_TERMINAL_RETENTION_MS = 300_000;

/** The Product shutdown wait budget handed to the Discovery Agent shutdown. */
export const PRODUCT_SHUTDOWN_TIMEOUT_MS = 10_000;

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
