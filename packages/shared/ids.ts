export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type RunId = Brand<string, 'RunId'>;
export type RunEventId = Brand<string, 'RunEventId'>;
export type AgentStepId = Brand<string, 'AgentStepId'>;
export type AgentActionId = Brand<string, 'AgentActionId'>;
export type AgentObservationId = Brand<string, 'AgentObservationId'>;
export type AgentDefinitionId = Brand<string, 'AgentDefinitionId'>;
export type AgentConfigSnapshotRef = Brand<string, 'AgentConfigSnapshotRef'>;
export type PolicySnapshotRef = Brand<string, 'PolicySnapshotRef'>;
export type AgentContextId = Brand<string, 'AgentContextId'>;
export type ContextPatchId = Brand<string, 'ContextPatchId'>;
export type ContextSourceId = Brand<string, 'ContextSourceId'>;
export type EffectiveContextBuildId = Brand<string, 'EffectiveContextBuildId'>;
export type ContextSelectionRecordId = Brand<string, 'ContextSelectionRecordId'>;
export type ContextRedactionRecordId = Brand<string, 'ContextRedactionRecordId'>;
export type ContextTruncationRecordId = Brand<string, 'ContextTruncationRecordId'>;
export type ProviderSettingsId = Brand<string, 'ProviderSettingsId'>;
export type SecretRefId = Brand<string, 'SecretRefId'>;

export type IsoDateTime = string;
