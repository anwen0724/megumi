import type { ProviderId } from '@megumi/shared/provider-contracts';

export type ComposerMode = 'chat' | 'agent' | 'plan';
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

interface ComposerOption<TValue extends string> {
  value: TValue;
  label: string;
}

interface ComposerModelOption extends ComposerOption<ComposerModel> {
  providerId: ProviderId;
}

export const COMPOSER_MODE_OPTIONS: ComposerOption<ComposerMode>[] = [
  { value: 'chat', label: 'Chat' },
  { value: 'agent', label: 'Agent' },
  { value: 'plan', label: 'Plan' },
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

export function getComposerModeLabel(mode: ComposerMode): string {
  return COMPOSER_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

export function getComposerModelLabel(model: string): string {
  return COMPOSER_MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model;
}

export function getProviderIdForModel(model: ComposerModel): ProviderId {
  return COMPOSER_MODEL_OPTIONS.find((option) => option.value === model)?.providerId ?? 'deepseek';
}
