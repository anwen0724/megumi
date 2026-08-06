/*
 * Defines the resolved execution limits shared by the Run execution base and all of its Runs.
 */

export interface RunPolicy {
  readonly maxModelCallsPerRun: number;
  readonly maxToolRoundsPerRun: number;
  readonly maxToolCallsPerModelCall: number;
  readonly maxToolCallsPerRun: number;
  readonly maxConcurrentToolExecutions: number;
  readonly modelCallTimeoutMs: number;
  readonly toolExecutionTimeoutMs: number;
  readonly cancellationTimeoutMs: number;
  readonly maxModelCallAttempts: number;
  readonly modelRetryDelayMs: number;
  readonly maxToolExecutionsPerCall: number;
  /** Context Overflow compaction recoveries allowed per logical ModelCall. */
  readonly maxContextOverflowRecoveries: number;
  /** Provider Request Retry budget passed to the AI adapter. */
  readonly providerRequestMaxRetries: number;
  /** Provider Request Retry delay cap passed to the AI adapter. */
  readonly providerRequestMaxRetryDelayMs: number;
  readonly terminalRunRetentionMs: number;
}

const POSITIVE_INTEGER_FIELDS = [
  'maxModelCallsPerRun',
  'maxToolRoundsPerRun',
  'maxToolCallsPerModelCall',
  'maxToolCallsPerRun',
  'maxConcurrentToolExecutions',
  'modelCallTimeoutMs',
  'toolExecutionTimeoutMs',
  'cancellationTimeoutMs',
  'maxModelCallAttempts',
  'maxToolExecutionsPerCall',
  'terminalRunRetentionMs',
] as const satisfies readonly (keyof RunPolicy)[];

const NON_NEGATIVE_INTEGER_FIELDS = [
  'modelRetryDelayMs',
  'maxContextOverflowRecoveries',
  'providerRequestMaxRetries',
  'providerRequestMaxRetryDelayMs',
] as const satisfies readonly (keyof RunPolicy)[];

/**
 * Engine accepts only a complete, already-resolved policy. Product composition owns defaults.
 */
export function validateRunPolicy(policy: RunPolicy): RunPolicy {
  for (const field of POSITIVE_INTEGER_FIELDS) {
    if (!Number.isInteger(policy[field]) || policy[field] <= 0) {
      throw new TypeError(`Invalid RunPolicy.${field}: expected a positive integer.`);
    }
  }

  for (const field of NON_NEGATIVE_INTEGER_FIELDS) {
    if (!Number.isInteger(policy[field]) || policy[field] < 0) {
      throw new TypeError(`Invalid RunPolicy.${field}: expected a non-negative integer.`);
    }
  }

  if (policy.maxToolExecutionsPerCall !== 1) {
    throw new TypeError(
      'Invalid RunPolicy.maxToolExecutionsPerCall: V2 requires exactly one execution per ToolCall.',
    );
  }

  return policy;
}
