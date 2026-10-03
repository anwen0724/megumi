/*
 * Defines application defaults injected by concrete Host composition roots.
 * It does not reimplement the policies enforced by those modules.
 */
import type { AgentExecutionPolicy } from '@megumi/agent';
import type { RecentEventBufferOptions } from './application';

export const PRODUCT_RECENT_EVENT_BUFFER = {
  maxSessions: 64,
  maxEventsPerSession: 2_048,
} satisfies RecentEventBufferOptions;

/** Execution limits supplied to each product configuration snapshot. */
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
} satisfies AgentExecutionPolicy;

/** How long Coding retains completed request identities and approval results. */
export const PRODUCT_TERMINAL_RETENTION_MS = 300_000;

/** How long application shutdown waits before reporting unfinished business work. */
export const PRODUCT_SHUTDOWN_TIMEOUT_MS = 10_000;

/** Converts the host platform identifier into the stable value shown to models. */
export function resolveModelVisibleOperatingSystem(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform;
}
