import { describe, expect, it } from 'vitest';
import {
  COMPOSER_MODE_OPTIONS,
  COMPOSER_MODEL_OPTIONS,
  getComposerModeLabel,
  getComposerModelLabel,
  getProviderIdForModel,
} from '@megumi/desktop/renderer/features/chat/components/composer-options';

describe('composer options', () => {
  it('lists supported composer modes', () => {
    expect(COMPOSER_MODE_OPTIONS.map((option) => option.value)).toEqual(['chat', 'agent', 'plan']);
    expect(getComposerModeLabel('chat')).toBe('Chat');
    expect(getComposerModeLabel('agent')).toBe('Agent');
    expect(getComposerModeLabel('plan')).toBe('Plan');
  });

  it('lists model options with provider ownership', () => {
    expect(COMPOSER_MODEL_OPTIONS).toEqual([
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
    ]);
  });

  it('maps selected models to provider ids', () => {
    expect(getProviderIdForModel('deepseek-v4-flash')).toBe('deepseek');
    expect(getProviderIdForModel('deepseek-v4-pro')).toBe('deepseek');
    expect(getProviderIdForModel('gpt-5.5')).toBe('openai');
    expect(getProviderIdForModel('gpt-4.1')).toBe('openai');
    expect(getProviderIdForModel('claude-sonnet-4-6')).toBe('anthropic');
  });

  it('falls back to raw labels for unknown values', () => {
    expect(getComposerModelLabel('custom-model')).toBe('custom-model');
  });
});
