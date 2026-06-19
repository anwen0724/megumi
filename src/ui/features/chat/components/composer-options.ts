import type { PermissionMode } from '@megumi/shared/permission';
import type { ProviderId } from '@megumi/shared/provider';

export type ComposerPermissionMode = PermissionMode;
export type ComposerModel =
  | 'deepseek-v4-flash'
  | 'deepseek-v4-pro'
  | 'gpt-5.5'
  | 'gpt-5.4'
  | 'gpt-5.4-mini'
  | 'gpt-5.4-nano'
  | 'gpt-4.1'
  | 'claude-opus-4-7'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5-20251001';

export const DEFAULT_COMPOSER_PERMISSION_MODE: ComposerPermissionMode = 'default';
export const DEFAULT_COMPOSER_MODEL: ComposerModel = 'deepseek-v4-flash';

interface ComposerOption<TValue extends string> {
  value: TValue;
  label: string;
}

export interface ComposerModelOption extends ComposerOption<ComposerModel> {
  providerId: ProviderId;
}

export const COMPOSER_PERMISSION_MODE_OPTIONS: ComposerOption<ComposerPermissionMode>[] = [
  { value: 'default', label: 'Default' },
  { value: 'accept_edits', label: 'Accept edits' },
  { value: 'plan', label: 'Plan' },
  { value: 'auto', label: 'Auto' },
];

export const COMPOSER_MODEL_OPTIONS: ComposerModelOption[] = [
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', providerId: 'deepseek' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', providerId: 'deepseek' },
  { value: 'gpt-5.5', label: 'GPT-5.5', providerId: 'openai' },
  { value: 'gpt-5.4', label: 'GPT-5.4', providerId: 'openai' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', providerId: 'openai' },
  { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', providerId: 'openai' },
  { value: 'gpt-4.1', label: 'GPT-4.1', providerId: 'openai' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7', providerId: 'anthropic' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', providerId: 'anthropic' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', providerId: 'anthropic' },
];

export function getComposerPermissionModeLabel(permissionMode: ComposerPermissionMode): string {
  return COMPOSER_PERMISSION_MODE_OPTIONS.find((option) => option.value === permissionMode)?.label ?? permissionMode;
}

export function getComposerModelLabel(model: string): string {
  return COMPOSER_MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model;
}

export function getProviderIdForModel(model: ComposerModel): ProviderId {
  return COMPOSER_MODEL_OPTIONS.find((option) => option.value === model)?.providerId ?? 'deepseek';
}

export function getComposerModelOptionsForProviders(enabledProviderIds?: ProviderId[]): ComposerModelOption[] {
  if (!enabledProviderIds) {
    return COMPOSER_MODEL_OPTIONS;
  }

  const enabledProviders = new Set(enabledProviderIds);
  return COMPOSER_MODEL_OPTIONS.filter((option) => enabledProviders.has(option.providerId));
}

