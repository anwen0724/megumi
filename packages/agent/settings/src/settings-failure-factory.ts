/* Defines the unified Settings failure protocol and its factory. */
import type { JsonValue } from '@megumi/ai';
import { z } from 'zod';

/** Safe load diagnostics never contain input values or parser exception text. */
export interface SettingsLoadIssue {
  path: string;
  message: string;
}

/** Converts validation failures to bounded diagnostics suitable for a user-facing boundary. */
export function settingsLoadIssues(error: unknown): SettingsLoadIssue[] {
  if (!(error instanceof z.ZodError)) return [{ path: '$', message: 'The settings file could not be read or parsed.' }];
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.join('.') || '$',
    // Zod messages may quote received enum values, URLs, or arbitrary keys. Do not forward them.
    message: issue.code === 'invalid_type' ? `Expected ${issue.expected}.`
      : issue.code === 'too_small' ? `Must be at least ${issue.minimum}.`
      : issue.code === 'too_big' ? `Must be at most ${issue.maximum}.`
      : issue.code === 'custom' ? safeConstraintMessage(issue.message)
      : 'The value does not match the supported format or options.',
  }));
}

/** Only these developer-owned constraint descriptions may cross the load-error boundary. */
function safeConstraintMessage(message: string): string {
  switch (message) {
    case 'Minimum count must be less than 80% of maximum count (rounded down).':
    case 'Recommendation target must not exceed recommendation working set.':
    case 'Recommendation working set must not exceed Candidate Pool maximum count.':
      return message;
    default:
      return 'Related configuration values are inconsistent.';
  }
}

/** JSON object alias owned by the Settings package; the AI package no longer exports it. */
export type JsonObject = { [key: string]: JsonValue };

export type SettingsFailureCode =
  | 'config_invalid'
  | 'provider_disabled'
  | 'provider_invalid_model'
  | 'filesystem_error';
export type SettingsFailureSource = 'config' | 'filesystem';
export interface SettingsFailure {
  code: SettingsFailureCode;
  message: string;
  severity: 'error';
  retryable: boolean;
  source: SettingsFailureSource;
  details: JsonObject & { settings_code: string };
  issues?: SettingsLoadIssue[];
}
export type SettingsFailureResult = { status: 'failed'; failure: SettingsFailure };
export type ReadApiKeyResult =
  | { status: 'found'; api_key: string; source: 'settings' | 'environment'; env_name?: string }
  | { status: 'missing' }
  | SettingsFailureResult;
export type WriteApiKeyResult = { status: 'updated' } | SettingsFailureResult;
export type DeleteApiKeyResult = { status: 'deleted' } | SettingsFailureResult;

export function createSettingsFailure(
  settingsCode: string,
  message: string,
  options: {
    code?: SettingsFailureCode;
    source?: SettingsFailureSource;
    retryable?: boolean;
    details?: JsonObject;
    issues?: SettingsLoadIssue[];
  } = {},
): SettingsFailureResult {
  return {
    status: 'failed',
    failure: {
      code: options.code ?? 'config_invalid',
      message,
      severity: 'error',
      retryable: options.retryable ?? false,
      source: options.source ?? 'config',
      ...(options.issues ? { issues: options.issues } : {}),
      details: {
        settings_code: settingsCode,
        ...(options.details ?? {}),
      },
    },
  };
}
