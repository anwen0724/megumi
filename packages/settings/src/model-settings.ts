/* Defines model selection and Context-capacity settings without owning model facts. */
import { z } from 'zod';
import type { SettingsFailureResult } from './settings-schema';
import type { ProviderSettingsResolved } from './provider-settings';

export const ContextSettingsRawSchema = z.object({
  compaction_threshold_ratio: z.number().gt(0).lt(1).optional(),
}).strict();
export type ContextSettingsRaw = z.infer<typeof ContextSettingsRawSchema>;

export const ContextSettingsResolvedSchema = z.object({
  compaction_threshold_ratio: z.number().gt(0).lt(1),
}).strict();
export type ContextSettingsResolved = z.infer<typeof ContextSettingsResolvedSchema>;

export const ModelSelectionSettingsSchema = z.object({
  provider_id: z.string().min(1),
  model_id: z.string().min(1),
}).strict();
export type ModelSelectionSettings = z.infer<typeof ModelSelectionSettingsSchema>;

export const ResolveModelSettingsRequestSchema = ModelSelectionSettingsSchema;
export type ResolveModelSettingsRequest = ModelSelectionSettings;

export type ResolvedModelSettings = {
  context_window_tokens: number;
  compaction_threshold_ratio: number;
};
export type ResolveModelSettingsResult =
  | { status: 'ok'; context: ResolvedModelSettings }
  | SettingsFailureResult;

export function resolveModelConfig(
  providers: Record<string, ProviderSettingsResolved>,
  context: ContextSettingsResolved,
  request: ResolveModelSettingsRequest,
): { status: 'ok'; context: ResolvedModelSettings } | { status: 'error'; settingsCode: string; message: string } {
  const model = providers[request.provider_id]?.models[request.model_id];
  if (!model) {
    return {
      status: 'error',
      settingsCode: 'provider_model_unknown',
      message: 'Provider model is not configured.',
    };
  }
  return {
    status: 'ok',
    context: {
      context_window_tokens: model.context_window_tokens,
      compaction_threshold_ratio: context.compaction_threshold_ratio,
    },
  };
}
