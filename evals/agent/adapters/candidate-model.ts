/*
 * Resolves an explicit Candidate Model config into a read-only per-run credential snapshot.
 */
import type { Api, Credential, CredentialStore } from '@megumi/ai';
import type { CandidateModelConfig } from '../contracts/evaluation-run';

export interface ResolvedCandidateModelConfig {
  readonly providerId: string;
  readonly modelId: string;
  readonly api: Api;
  readonly baseUrl: string;
  readonly displayName: string;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
}

export interface ResolvedCandidateModel {
  readonly source: CandidateModelConfig['source'];
  readonly config: ResolvedCandidateModelConfig;
  readonly credentials: CredentialStore;
}

/** Resolves the Candidate Model once so every selected Case uses the same validated configuration. */
export async function resolveCandidateModel(input: {
  readonly config: CandidateModelConfig;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): Promise<ResolvedCandidateModel> {
  const key = input.environment[input.config.credentialEnvironmentVariable]?.trim();
  if (!key) throw new Error(
    `Required Evaluation credential is missing: ${input.config.credentialEnvironmentVariable}.`,
  );
  return {
    source: input.config.source,
    config: {
      providerId: input.config.providerId,
      modelId: input.config.modelId,
      api: input.config.api,
      baseUrl: input.config.baseUrl,
      displayName: input.config.modelId,
      contextWindowTokens: input.config.contextWindowTokens,
      maxOutputTokens: input.config.maxOutputTokens,
    },
    credentials: createReadOnlyCredentialStore(input.config.providerId, { type: 'api_key', key }),
  };
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
