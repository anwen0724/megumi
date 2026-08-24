/* Exposes stable Settings contracts while hiding the secret-bearing file model. */
export { createSettingsCredentialStore } from './settings-credential-store';
export {
  createRecordSettingsEnvironment,
  emptySettingsEnvironment,
  type SettingsEnvironment,
} from './settings-environment';

export {
  createSettings,
} from './settings';
export type {
  CreateSettingsRequest,
  Settings,
} from './settings';
export {
  CompleteSetupProviderRequestSchema,
  CompleteSetupRequestSchema,
  DEFAULT_SETTINGS,
  MemorySettingsRawSchema,
  MemorySettingsResolvedSchema,
  SettingsLanguageSchema,
  SettingsRawSchema,
  SettingsResolvedSchema,
  SettingsThemeNameSchema,
  SetupSettingsRawSchema,
  SetupSettingsResolvedSchema,
  UpdateSettingsRequestSchema,
} from './settings-schema';
export type {
  CompleteSetupRequest,
  CompleteSetupResult,
  DeleteApiKeyResult,
  MemorySettingsRaw,
  MemorySettingsResolved,
  ReadApiKeyResult,
  SettingsFailure,
  SettingsFailureCode,
  SettingsFailureResult,
  SettingsFailureSource,
  SettingsLanguage,
  SettingsRaw,
  SettingsResolved,
  SettingsThemeName,
  SetupSettingsRaw,
  SetupSettingsResolved,
  UpdateSettingsRequest,
  UpdateSettingsResult,
  WriteApiKeyResult,
} from './settings-schema';
export {
  createSettingsJsonSchema,
  type SettingsJsonSchemaObject,
} from './settings-json-schema';
export {
  AvailableModelOptionSchema,
  DeleteProviderApiKeyRequestSchema,
  DeleteProviderSettingsRequestSchema,
  GetProviderSettingsRequestSchema,
  ProviderApiSchema,
  ProviderCredentialSourceSchema,
  ProviderIdSchema,
  ProviderModelSettingsRawSchema,
  ProviderModelSettingsResolvedSchema,
  ProviderPublicStatusSchema,
  ProviderSettingsRawSchema,
  ProviderSettingsResolvedSchema,
  ReadProviderApiKeyRequestSchema,
  ResolvedProviderSettingsSchema,
  ResolveProviderSettingsRequestSchema,
  UpdateProviderSettingsRequestSchema,
  WriteProviderApiKeyRequestSchema,
} from './provider-settings';
export type {
  AvailableModelOption,
  DeleteProviderApiKeyRequest,
  DeleteProviderSettingsRequest,
  DeleteProviderSettingsResult,
  GetProviderSettingsRequest,
  GetProviderSettingsResult,
  ListAvailableModelsResult,
  ListProviderSettingsResult,
  ProviderApi,
  ProviderCatalogDefinition,
  ProviderCredentialSource,
  ProviderId,
  ProviderModelSettingsRaw,
  ProviderModelSettingsResolved,
  ProviderPublicStatus,
  ProviderSettingsRaw,
  ProviderSettingsResolved,
  ReadProviderApiKeyRequest,
  ResolvedProviderSettings,
  ResolveProviderSettingsRequest,
  ResolveProviderSettingsResult,
  UpdateProviderSettingsRequest,
  UpdateProviderSettingsResult,
  WriteProviderApiKeyRequest,
} from './provider-settings';
export {
  ContextSettingsRawSchema,
  ContextSettingsResolvedSchema,
  ModelSelectionSettingsSchema,
  ResolveModelSettingsRequestSchema,
} from './model-settings';
export type {
  ContextSettingsRaw,
  ContextSettingsResolved,
  ModelSelectionSettings,
  ResolvedModelSettings,
  ResolveModelSettingsRequest,
  ResolveModelSettingsResult,
} from './model-settings';
export {
  RecordSessionPermissionGrantRequestSchema,
  ChangePermissionRulesRequestSchema,
  PermissionRuleEffectSchema,
  PermissionRuleSchema,
  PermissionRulesRawSchema,
  PermissionSettingsSchema,
  ResolvePermissionSettingsRequestSchema,
} from './permission-settings';
export type {
  RecordSessionPermissionGrantRequest,
  AddPermissionRulesResult,
  ChangePermissionRulesRequest,
  ChangePermissionRulesResult,
  PermissionRule,
  PermissionRuleEffect,
  PermissionRulesRaw,
  PermissionSettings,
  ResolvePermissionSettingsRequest,
} from './permission-settings';
export {
  DEFAULT_WEB_SEARCH_API_KEY_ENV,
  DeleteWebSearchApiKeyRequestSchema,
  ReadWebSearchApiKeyRequestSchema,
  WebSearchProviderSchema,
  WebSearchSettingsRawSchema,
  WebSearchSettingsResolvedSchema,
  WriteWebSearchApiKeyRequestSchema,
} from './web-search-settings';
export type {
  DeleteWebSearchApiKeyRequest,
  ReadWebSearchApiKeyRequest,
  ResolvedWebSearchSettings,
  ResolveWebSearchSettingsResult,
  WebSearchCredentialSource,
  WebSearchProvider,
  WebSearchSettingsRaw,
  WebSearchSettingsResolved,
  WriteWebSearchApiKeyRequest,
} from './web-search-settings';
export {
  DEFAULT_VOICE_TTS_API_KEY_ENV,
  DeleteVoiceTtsApiKeyRequestSchema,
  ReadVoiceTtsApiKeyRequestSchema,
  VoiceTtsProviderSchema,
  VoiceTtsSettingsRawSchema,
  VoiceTtsSettingsResolvedSchema,
  WriteVoiceTtsApiKeyRequestSchema,
} from './voice-tts-settings';
export type {
  DeleteVoiceTtsApiKeyRequest,
  ReadVoiceTtsApiKeyRequest,
  ResolvedVoiceTtsSettings,
  ResolveVoiceTtsSettingsResult,
  VoiceTtsCredentialSource,
  VoiceTtsProvider,
  VoiceTtsSettingsRaw,
  VoiceTtsSettingsResolved,
  WriteVoiceTtsApiKeyRequest,
} from './voice-tts-settings';
export type {
  SettingsStore,
} from './settings-store';
export {
  DEFAULT_DISCOVERY_SETTINGS,
  DiscoverySettingsRawSchema,
  DiscoverySettingsResolvedSchema,
  DiscoverySourceIdSchema,
  resolveDiscoverySettings,
} from './discovery-settings';
export type {
  DiscoverySettingsRaw,
  DiscoverySettingsResolved,
  DiscoverySourceId,
} from './discovery-settings';
export {
  LegacyPermissionSettingsMigrationError,
  migrateLegacyPermissionSettings,
  migrateLegacyPermissionSettingsFile,
} from './migrations/legacy-permission-settings';
export {
  migrateLegacyProviderApiSettings,
  migrateLegacyProviderApiSettingsFile,
} from './migrations/legacy-provider-api-settings';
