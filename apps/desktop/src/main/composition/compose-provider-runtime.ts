// Composes provider settings, provider runtime resolution, and model-step streaming.
import { createModelStepProviderService } from '../services/runtime/model-step-provider.service';
import { ProviderRuntimeService } from '../services/provider/provider-runtime.service';
import { ProviderSettingsService } from '../services/provider/provider-settings.service';
import type { AppSettingsService } from '../services/settings/app-settings.service';

export function composeProviderRuntime(appSettingsService: AppSettingsService) {
  const providerSettingsService = new ProviderSettingsService({
    settings: appSettingsService,
  });
  const providerRuntimeService = new ProviderRuntimeService({
    settings: providerSettingsService,
  });

  return {
    providerSettingsService,
    providerRuntimeService,
    modelStepProviderService: createModelStepProviderService(providerRuntimeService),
  };
}
