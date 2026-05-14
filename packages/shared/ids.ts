export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type RunId = Brand<string, 'RunId'>;
export type RunEventId = Brand<string, 'RunEventId'>;
export type ProviderSettingsId = Brand<string, 'ProviderSettingsId'>;
export type SecretRefId = Brand<string, 'SecretRefId'>;

export type IsoDateTime = string;
