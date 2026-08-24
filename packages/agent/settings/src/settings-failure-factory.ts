/* Defines the unified Settings failure protocol and its factory. */
import type { JsonValue } from '@megumi/ai';

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
      details: {
        settings_code: settingsCode,
        ...(options.details ?? {}),
      },
    },
  };
}
