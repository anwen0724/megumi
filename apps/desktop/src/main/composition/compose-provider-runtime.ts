// Composes provider settings, provider runtime resolution, and model-step streaming.
import { createModelStepProviderService } from '../services/runtime/model-step-provider.service';
import { ProviderRuntimeService, ProviderSettingsService } from '@megumi/coding-agent/settings';
import type { AppSettingsService } from '../services/settings/app-settings.service';

export function composeProviderRuntime(appSettingsService: AppSettingsService) {
  const providerSettingsService = new ProviderSettingsService({
    settings: appSettingsService,
    env: process.env,
  });
  const providerRuntimeService = new ProviderRuntimeService({
    settings: providerSettingsService,
    env: process.env,
  });

  return {
    providerSettingsService,
    providerRuntimeService,
    modelStepProviderService: createModelStepProviderService(providerRuntimeService),
  };
}
