import type { PermissionMode } from '@megumi/product/host-interface';
import type { ModelSupportLevelUi, ProviderPublicStatusUiDto } from '@megumi/product/host-interface';

export type ComposerPermissionMode = PermissionMode;
export type ComposerModel = string;

export const DEFAULT_COMPOSER_PERMISSION_MODE: ComposerPermissionMode = 'default';
export const DEFAULT_COMPOSER_MODEL: ComposerModel = '';

interface ComposerOption<TValue extends string> {
  value: TValue;
  label: string;
}

export interface ComposerModelOption extends ComposerOption<ComposerModel> {
  providerId: string;
  modelId: string;
  imageInput: ModelSupportLevelUi;
}

export const COMPOSER_PERMISSION_MODE_OPTIONS: ComposerOption<ComposerPermissionMode>[] = [
  { value: 'default', label: 'Default' },
  { value: 'accept_edits', label: 'Accept edits' },
  { value: 'plan', label: 'Plan' },
  { value: 'auto', label: 'Auto' },
];

export function getComposerModelLabel(model: string, modelOptions: ComposerModelOption[] = []): string {
  return modelOptions.find((option) => option.value === model)?.label ?? model;
}

export function getComposerPermissionModeLabel(permissionMode: ComposerPermissionMode): string {
  return COMPOSER_PERMISSION_MODE_OPTIONS.find((option) => option.value === permissionMode)?.label ?? permissionMode;
}

export function getComposerModelOptionsForProviders(providers?: ProviderPublicStatusUiDto[]): ComposerModelOption[] {
  if (!providers) {
    return [];
  }

  return providers
    .filter((provider) => provider.enabled && provider.hasApiKey)
    .flatMap((provider) => provider.modelIds.map((modelId) => ({
      value: modelOptionValue(provider.providerId, String(modelId)),
      modelId: String(modelId),
      providerId: provider.providerId,
      imageInput: provider.modelCapabilities?.[modelId]?.imageInput ?? 'unknown',
      label: String(modelId),
    })));
}

export function modelOptionValue(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}
