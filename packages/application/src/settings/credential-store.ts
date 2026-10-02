/* Stores authentication values separately from configuration files. */
import { z } from 'zod';
import {
  ReadCredentialRequestSchema,
  UpdateCredentialRequestSchema,
  type CredentialTarget,
  type ReadCredentialRequest,
  type ReadCredentialResult,
  type UpdateCredentialRequest,
  type UpdateCredentialResult,
} from './settings-contracts';
import { readJsonFile, writeJsonFile } from './json-file';

const SecretSchema = z.string().trim().min(1);
const CredentialFileSchema = z
  .object({
    providers: z.record(SecretSchema).optional(),
    webSearch: SecretSchema.optional(),
    voiceTts: SecretSchema.optional(),
    discoverySources: z
      .object({ twitter: SecretSchema.optional(), zhihu: SecretSchema.optional() })
      .optional(),
  })
  .passthrough();
type CredentialFile = z.infer<typeof CredentialFileSchema>;

/** Binds the two credential operations to one global file. */
export function createCredentialStore(
  filePath: string,
  readEnvironment: (name: string) => string | undefined,
) {
  return {
    /** Reads current credentials without exposing them through configuration snapshots. */
    readCredential(request: ReadCredentialRequest): ReadCredentialResult {
      const parsed = ReadCredentialRequestSchema.safeParse(request);
      if (!parsed.success) return invalidCredential('CREDENTIAL_INVALID');
      const file = readCredentialFile(filePath);
      if (file.status === 'rejected') return file;
      const value = storedCredential(file.document, parsed.data.target);
      if (value) return { status: 'found', value, source: 'stored' };
      const names = parsed.data.apiKeyEnv
        ? [parsed.data.apiKeyEnv]
        : (parsed.data.defaultEnvNames ?? []);
      for (const name of names) {
        const environmentValue = readEnvironment(name)?.trim();
        if (environmentValue)
          return { status: 'found', value: environmentValue, source: 'environment' };
      }
      return { status: 'missing' };
    },

    /** Updates one target in the latest document and never returns its secret. */
    updateCredential(request: UpdateCredentialRequest): UpdateCredentialResult {
      const parsed = UpdateCredentialRequestSchema.safeParse(request);
      if (!parsed.success) return invalidCredential('CREDENTIAL_INVALID');
      const file = readCredentialFile(filePath);
      if (file.status === 'rejected') return file;
      const { target, value } = parsed.data;
      if ((storedCredential(file.document, target) ?? null) === value)
        return { status: 'unchanged' };
      const next = { ...file.document };
      if (target.kind === 'provider') {
        const providers = { ...next.providers };
        if (value === null) delete providers[target.providerId];
        else
          Object.defineProperty(providers, target.providerId, {
            value,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        next.providers = providers;
      } else if (target.kind === 'discoverySource') {
        const sources = { ...next.discoverySources };
        if (value === null) delete sources[target.sourceId];
        else sources[target.sourceId] = value;
        next.discoverySources = sources;
      } else if (value === null) {
        delete next[target.kind];
      } else {
        next[target.kind] = value;
      }
      writeJsonFile(filePath, next);
      return { status: 'updated' };
    },
  };
}

function readCredentialFile(filePath: string) {
  const file = readJsonFile(filePath);
  if (file.status === 'invalid') return invalidCredential('CREDENTIAL_FILE_INVALID');
  const parsed = CredentialFileSchema.safeParse(file.document);
  return parsed.success
    ? { status: 'ok' as const, document: parsed.data }
    : invalidCredential('CREDENTIAL_FILE_INVALID');
}

function storedCredential(file: CredentialFile, target: CredentialTarget): string | undefined {
  if (target.kind === 'provider') return file.providers?.[target.providerId];
  if (target.kind === 'discoverySource') return file.discoverySources?.[target.sourceId];
  return file[target.kind];
}

function invalidCredential(
  code: 'CREDENTIAL_INVALID' | 'CREDENTIAL_FILE_INVALID',
): Extract<ReadCredentialResult, { status: 'rejected' }> {
  return {
    status: 'rejected',
    error: {
      code,
      message:
        code === 'CREDENTIAL_INVALID'
          ? 'Invalid credential request.'
          : 'The credential file is invalid.',
    },
  };
}
