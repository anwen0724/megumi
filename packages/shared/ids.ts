export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type RunId = Brand<string, 'RunId'>;
export type RunEventId = Brand<string, 'RunEventId'>;
export type RunStepId = Brand<string, 'RunStepId'>;
export type RunActionId = Brand<string, 'RunActionId'>;
export type RunObservationId = Brand<string, 'RunObservationId'>;
export type AgentDefinitionId = Brand<string, 'AgentDefinitionId'>;
export type AgentConfigSnapshotRef = Brand<string, 'AgentConfigSnapshotRef'>;
export type PolicySnapshotRef = Brand<string, 'PolicySnapshotRef'>;
export type RunContextId = Brand<string, 'RunContextId'>;
export type ContextPatchId = Brand<string, 'ContextPatchId'>;
export type ContextSourceId = Brand<string, 'ContextSourceId'>;
export type RunContextBuildId = Brand<string, 'RunContextBuildId'>;
export type ContextSelectionRecordId = Brand<string, 'ContextSelectionRecordId'>;
export type ContextRedactionRecordId = Brand<string, 'ContextRedactionRecordId'>;
export type ContextTruncationRecordId = Brand<string, 'ContextTruncationRecordId'>;
export type ProviderSettingsId = Brand<string, 'ProviderSettingsId'>;
export type SecretRefId = Brand<string, 'SecretRefId'>;

export type AgentStepId = RunStepId;
export type AgentActionId = RunActionId;
export type AgentObservationId = RunObservationId;
export type AgentContextId = RunContextId;
export type EffectiveContextBuildId = RunContextBuildId;

export type IsoDateTime = string;
