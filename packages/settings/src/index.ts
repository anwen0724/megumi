/* Exposes stable Settings contracts while hiding the secret-bearing file model. */
export { createSettingsCredentialStore } from './settings-credential-store';
export {
  createRecordSettingsEnvironment,
  emptySettingsEnvironment,
  type SettingsEnvironment,
} from './settings-environment';

export {
  SettingsOperationError,
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
  createSettingsJsonSchema,
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
  SettingsJsonSchemaObject,
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
  AddPermissionRulesRequestSchema,
  ChangePermissionRulesRequestSchema,
  PermissionRuleEffectSchema,
  PermissionRuleSchema,
  PermissionRulesRawSchema,
  PermissionSettingsSchema,
  ResolvePermissionSettingsRequestSchema,
} from './permission-settings';
export type {
  AddPermissionRulesRequest,
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
export type {
  SettingsStore,
} from './settings-store';
