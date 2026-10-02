/* Defines Voice TTS provider settings while keeping credentials behind explicit methods. */
import { z } from 'zod';
import type {
  ReadApiKeyResult,
  SettingsFailureResult,
} from './settings-schema';
import type { SettingsEnvironment } from './settings-environment';

export const VoiceTtsProviderSchema = z.enum(['minimax']);
export type VoiceTtsProvider = z.infer<typeof VoiceTtsProviderSchema>;

export const VoiceTtsSettingsRawSchema = z.object({
  provider: VoiceTtsProviderSchema.optional(),
  voice_id: z.string().min(1).optional(),
  api_key_env: z.string().min(1).nullable().optional(),
}).strict();
export type VoiceTtsSettingsRaw = z.infer<typeof VoiceTtsSettingsRawSchema>;

// The key remains in settings.json but this schema is not exported publicly.
// Voice TTS files may carry user-added fields.
export const VoiceTtsSettingsFileRawSchema = VoiceTtsSettingsRawSchema.extend({
  api_key: z.string().min(1).nullable().optional(),
}).passthrough();
export type VoiceTtsSettingsFileRaw = z.infer<typeof VoiceTtsSettingsFileRawSchema>;

export const VoiceTtsSettingsResolvedSchema = z.object({
  provider: VoiceTtsProviderSchema,
  voice_id: z.string().min(1),
  has_api_key: z.boolean(),
  credential_source: z.enum(['settings', 'environment', 'missing']),
}).strict();
export type VoiceTtsSettingsResolved = z.infer<typeof VoiceTtsSettingsResolvedSchema>;

export type VoiceTtsCredentialSource = 'settings' | 'environment' | 'missing';
export type ResolvedVoiceTtsSettings = VoiceTtsSettingsResolved;
export type ResolveVoiceTtsSettingsResult =
  | { status: 'ok'; settings: ResolvedVoiceTtsSettings }
  | SettingsFailureResult;

export const ReadVoiceTtsApiKeyRequestSchema = z.object({}).strict();
export type ReadVoiceTtsApiKeyRequest = z.infer<typeof ReadVoiceTtsApiKeyRequestSchema>;
export const WriteVoiceTtsApiKeyRequestSchema = z.object({
  api_key: z.string().min(1),
}).strict();
export type WriteVoiceTtsApiKeyRequest = z.infer<typeof WriteVoiceTtsApiKeyRequestSchema>;
export const DeleteVoiceTtsApiKeyRequestSchema = z.object({}).strict();
export type DeleteVoiceTtsApiKeyRequest = z.infer<typeof DeleteVoiceTtsApiKeyRequestSchema>;

export const DEFAULT_VOICE_TTS_API_KEY_ENV: Readonly<Record<VoiceTtsProvider, string>> = {
  minimax: 'MINIMAX_API_KEY',
};

export function resolveVoiceTtsSettings(
  resolved: VoiceTtsSettingsResolved,
  file: VoiceTtsSettingsFileRaw,
  environment: SettingsEnvironment,
): ResolvedVoiceTtsSettings {
  const credential = readVoiceTtsApiKey(file, environment);
  return {
    ...resolved,
    has_api_key: credential.status === 'found',
    credential_source: credential.status === 'found' ? credential.source : 'missing',
  };
}

export function readVoiceTtsApiKey(
  file: VoiceTtsSettingsFileRaw,
  environment: SettingsEnvironment,
): ReadApiKeyResult {
  const direct = file.api_key?.trim();
  if (direct) return { status: 'found', api_key: direct, source: 'settings' };
  const envName = file.api_key_env ?? DEFAULT_VOICE_TTS_API_KEY_ENV.minimax;
  const fromEnv = envName ? environment.readVariable(envName)?.trim() : undefined;
  return fromEnv
    ? { status: 'found', api_key: fromEnv, source: 'environment', env_name: envName }
    : { status: 'missing' };
}
