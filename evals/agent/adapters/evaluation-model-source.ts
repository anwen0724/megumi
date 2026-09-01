/*
 * Resolves Evaluation model selections through Megumi Settings and materializes
 * read-only per-run AI CredentialStores without exposing secrets to artifacts.
 */
import path from 'node:path';
import type { Api, Credential, CredentialStore } from '@megumi/ai';
import {
  createRecordSettingsEnvironment,
  createSettings,
  createSettingsCredentialStore,
  type ResolvedProviderSettings,
  type Settings,
} from '@megumi/settings';
import { createSettingsStore } from '@megumi/settings/store';
import type {
  EvaluationModelSource,
  EvaluationRunConfig,
} from '../contracts/evaluation-run-config';

export interface ResolvedEvaluationModelConfig {
  readonly providerId: string;
  readonly modelId: string;
  readonly api: Api;
  readonly baseUrl: string;
  readonly displayName: string;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
}

export interface ResolvedEvaluationModel {
  readonly source: EvaluationModelSource['source'];
  readonly config: ResolvedEvaluationModelConfig;
  readonly credentials: CredentialStore;
}

export interface ResolvedEvaluationModels {
  readonly candidate: ResolvedEvaluationModel;
  readonly grader: ResolvedEvaluationModel;
}

/** Resolves both model roles once so every Task uses the same validated public configuration and credentials. */
export async function resolveEvaluationModels(input: {
  readonly config: EvaluationRunConfig;
  readonly megumiHomePath: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): Promise<ResolvedEvaluationModels> {
  const settings = createSettings({
    store: createSettingsStore({ settingsPath: path.join(input.megumiHomePath, 'settings.json') }),
    environment: createRecordSettingsEnvironment(input.environment),
  });
  const settingsCredentials = createSettingsCredentialStore(settings);
  const [candidate, grader] = await Promise.all([
    resolveEvaluationModel(input.config.candidateModel, settings, settingsCredentials, input.environment),
    resolveEvaluationModel(input.config.graderModel, settings, settingsCredentials, input.environment),
  ]);
  return { candidate, grader };
}

/** Resolves one discriminated model source into the single runtime form consumed by AI composition. */
async function resolveEvaluationModel(
  source: EvaluationModelSource,
  settings: Settings,
  settingsCredentials: CredentialStore,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<ResolvedEvaluationModel> {
  if (source.source === 'custom') {
    return {
      source: source.source,
      config: {
        providerId: source.providerId,
        modelId: source.modelId,
        api: source.api,
        baseUrl: source.baseUrl,
        displayName: source.modelId,
        contextWindowTokens: source.contextWindowTokens,
        maxOutputTokens: source.maxOutputTokens,
      },
      credentials: await resolveCustomCredentials(source, settingsCredentials, environment),
    };
  }

  const selection = source.source === 'current'
    ? currentModelSelection(settings)
    : { providerId: source.providerId, modelId: source.modelId };
  const resolved = settings.resolveProvider({
    provider_id: selection.providerId,
    model_id: selection.modelId,
  });
  if (resolved.status === 'failed') throw new Error(resolved.failure.message);
  return {
    source: source.source,
    config: fromSettingsModel(resolved.config),
    credentials: await materializeCredentialStore({
      targetProviderId: resolved.config.provider_id,
      sourceProviderId: resolved.config.provider_id,
      source: settingsCredentials,
    }),
  };
}

/** Reads the current product selection without permitting Evaluation to mutate Product Settings. */
function currentModelSelection(settings: Settings): { readonly providerId: string; readonly modelId: string } {
  const resolved = settings.resolve();
  if (resolved.status === 'failed') throw new Error(resolved.failure.message);
  const selection = resolved.settings.model_selection;
  if (!selection) throw new Error('Megumi Settings does not define a current model selection.');
  return { providerId: selection.provider_id, modelId: selection.model_id };
}

/** Converts Settings terminology to the Evaluation runtime model vocabulary. */
function fromSettingsModel(config: ResolvedProviderSettings): ResolvedEvaluationModelConfig {
  return {
    providerId: config.provider_id,
    modelId: config.model_id,
    api: config.api,
    baseUrl: config.base_url,
    displayName: config.display_name,
    contextWindowTokens: config.context_window_tokens,
    maxOutputTokens: config.max_output_tokens,
  };
}

/** Resolves a custom model's explicit credential reference into the standard AI CredentialStore. */
async function resolveCustomCredentials(
  source: Extract<EvaluationModelSource, { source: 'custom' }>,
  settingsCredentials: CredentialStore,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<CredentialStore> {
  if (source.credential.source === 'settings') {
    return materializeCredentialStore({
      targetProviderId: source.providerId,
      sourceProviderId: source.credential.providerId,
      source: settingsCredentials,
    });
  }
  const key = environment[source.credential.environmentVariable]?.trim();
  if (!key) {
    throw new Error(`Required Evaluation credential is missing: ${source.credential.environmentVariable}.`);
  }
  return createReadOnlyCredentialStore(source.providerId, { type: 'api_key', key });
}

/** Copies one credential into a run-owned store so Evaluation cannot mutate Product Settings. */
async function materializeCredentialStore(input: {
  readonly targetProviderId: string;
  readonly sourceProviderId: string;
  readonly source: CredentialStore;
}): Promise<CredentialStore> {
  const credential = await input.source.read(input.sourceProviderId);
  if (!credential) throw new Error(`Evaluation credential is missing for Provider: ${input.sourceProviderId}.`);
  return createReadOnlyCredentialStore(input.targetProviderId, credential);
}

/** Creates an isolated credential snapshot and rejects mutation attempts from Evaluation callers. */
function createReadOnlyCredentialStore(providerId: string, credential: Credential): CredentialStore {
  return {
    async read(requestedProviderId, options) {
      options?.signal?.throwIfAborted();
      return requestedProviderId === providerId ? credential : undefined;
    },
    async list(options) {
      options?.signal?.throwIfAborted();
      return [{ providerId, type: credential.type }];
    },
    async modify() {
      throw new Error('Evaluation credentials are read-only.');
    },
    async delete() {
      throw new Error('Evaluation credentials are read-only.');
    },
  };
}
