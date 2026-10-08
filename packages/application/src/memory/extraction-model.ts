/* Resolves extraction against application settings independently of foreground workspace scope. */
import type { createApplicationModels } from '../compose-modules';
import type { Settings } from '../settings/settings-store';
import type { ModelSelection } from '../contracts';
import type { ExtractionModel } from './extraction-contracts';
import type { ReadCredentialRequest } from '../settings/settings-contracts';
import type { ConsolidationModel } from './consolidation-agent';

export async function resolveConsolidationModel(options: Parameters<typeof resolveExtractionModel>[0]): Promise<ConsolidationModel> {
  const resolved = await resolveExtractionModel(options);
  const { models } = options;
  return { model: resolved.model, ai: {
    streamSimple: (model, context, request) => models.withWorkspace(undefined, () => models.ai.streamSimple(model, context, { ...request, maxTokens: Math.min(8192, model.maxTokens) })),
    completeSimple: (model, context, request) => models.withWorkspace(undefined, () => models.ai.completeSimple(model, context, { ...request, maxTokens: Math.min(8192, model.maxTokens) })),
  } };
}

export async function resolveExtractionModel(options: {
  readonly models: ReturnType<typeof createApplicationModels>;
  readonly settings: Settings;
  readonly selection: ModelSelection;
}): Promise<ExtractionModel> {
  return options.models.withWorkspace(undefined, async () => {
    const resolved = await options.models.resolveModel({ selection: options.selection });
    if (resolved.status !== 'ok') throw new Error('MODEL_UNAVAILABLE');
    const read = options.settings.readSettings();
    if (read.status !== 'ok') throw new Error('SETTINGS_INVALID');
    const config = read.settings.config;
    const requests: ReadCredentialRequest[] = [
      ...Object.entries(config.providers).map(([providerId, provider]) => ({ target: { kind: 'provider' as const, providerId }, apiKeyEnv: provider.apiKeyEnv })),
      { target: { kind: 'webSearch' }, apiKeyEnv: config.webSearch.apiKeyEnv },
      { target: { kind: 'voiceTts' }, apiKeyEnv: config.voice.tts.apiKeyEnv, defaultEnvNames: ['MINIMAX_API_KEY'] },
      { target: { kind: 'discoverySource', sourceId: 'tavily' }, defaultEnvNames: ['TAVILY_API_KEY'] },
      { target: { kind: 'discoverySource', sourceId: 'zhihu' }, defaultEnvNames: ['ZHIHU_ACCESS_SECRET'] },
      { target: { kind: 'discoverySource', sourceId: 'twitter' } },
    ];
    const secrets = requests.flatMap(request => {
      const result = options.settings.readCredential(request);
      if (result.status === 'rejected') throw new Error('CREDENTIALS_UNAVAILABLE');
      return result.status === 'found' ? [result.value] : [];
    });
    const auth = await options.models.ai.getAuth(resolved.model);
    if (auth?.auth.apiKey) secrets.push(auth.auth.apiKey);
    for (const value of Object.values(auth?.auth.headers ?? {})) if (typeof value === 'string') secrets.push(value);
    return { model: resolved.model, secrets: [...new Set(secrets)],
      complete: (context, request) => options.models.withWorkspace(undefined,
        () => options.models.ai.completeSimple(resolved.model, context, request)) };
  });
}
