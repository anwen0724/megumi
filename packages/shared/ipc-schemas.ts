import { z } from 'zod';
import {
  createRuntimeIpcRequestSchema,
  createRuntimeIpcResultSchema,
  IsoDateTimeSchema,
  RuntimeIpcRequestIdSchema,
} from './ipc-contracts';
import {
  AgentRunSchema,
  AgentSessionSchema,
  MessageSchema,
} from './agent-lifecycle-contracts';
import { IPC_CHANNELS } from './ipc-channels';
import { PROVIDER_IDS, type ProviderId } from './provider-contracts';

const PROVIDER_ID_VALUES = [...PROVIDER_IDS] as [ProviderId, ...ProviderId[]];

export const ProviderIdSchema = z.enum(PROVIDER_ID_VALUES);

export const ProviderCredentialSourceSchema = z.enum([
  'secret-store',
  'environment',
  'config',
  'missing',
]);

export const ProviderPublicStatusSchema = z
  .object({
    providerId: ProviderIdSchema,
    displayName: z.string().min(1),
    enabled: z.boolean(),
    baseUrl: z.string().url().optional(),
    defaultModelId: z.string().min(1),
    hasSecret: z.boolean(),
    credentialSource: ProviderCredentialSourceSchema,
    envOverrideActive: z.boolean(),
  })
  .strict();

export const ProviderListPayloadSchema = z.object({}).strict();

export const ProviderListDataSchema = z
  .object({
    providers: z.array(ProviderPublicStatusSchema),
  })
  .strict();

export const ProviderUpdatePayloadSchema = z
  .object({
    providerId: ProviderIdSchema,
    enabled: z.boolean().optional(),
    displayName: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    defaultModelId: z.string().min(1).optional(),
  })
  .strict();

export const ProviderApiKeyPayloadSchema = z
  .object({
    providerId: ProviderIdSchema,
    apiKey: z.string().min(1),
  })
  .strict();

export const ProviderDeleteApiKeyPayloadSchema = z
  .object({
    providerId: ProviderIdSchema,
  })
  .strict();

export const ProviderEmptyDataSchema = z.object({}).strict();

export const ProviderListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.provider.list,
  ProviderListPayloadSchema,
);

export const ProviderUpdateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.provider.update,
  ProviderUpdatePayloadSchema,
);

export const ProviderApiKeyRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.provider.setApiKey,
  ProviderApiKeyPayloadSchema,
);

export const ProviderDeleteApiKeyRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.provider.deleteApiKey,
  ProviderDeleteApiKeyPayloadSchema,
);

export const ProviderListResultSchema = createRuntimeIpcResultSchema(
  ProviderListDataSchema,
  IPC_CHANNELS.provider.list,
);

export const ProviderUpdateResultSchema = createRuntimeIpcResultSchema(
  ProviderEmptyDataSchema,
  IPC_CHANNELS.provider.update,
);

export const ProviderApiKeyResultSchema = createRuntimeIpcResultSchema(
  ProviderEmptyDataSchema,
  IPC_CHANNELS.provider.setApiKey,
);

export const ProviderDeleteApiKeyResultSchema = createRuntimeIpcResultSchema(
  ProviderEmptyDataSchema,
  IPC_CHANNELS.provider.deleteApiKey,
);

export const ChatRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export const ComposerModeSchema = z.enum(['chat', 'agent', 'plan']);

export const ChatMessageSchema = z
  .object({
    id: z.string().min(1),
    role: ChatRoleSchema,
    content: z.string(),
    createdAt: IsoDateTimeSchema,
    name: z.string().min(1).optional(),
    toolCallId: z.string().min(1).optional(),
  })
  .strict();

export const ChatRuntimeContextSchema = z
  .object({
    workspaceId: z.string().min(1).optional(),
    workspaceLabel: z.string().min(1).optional(),
    workspacePath: z.string().min(1).optional(),
    sessionTitle: z.string().min(1).optional(),
    composerMode: ComposerModeSchema.optional(),
  })
  .strict();

export const ChatStartPayloadSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    providerId: ProviderIdSchema,
    modelId: z.string().min(1),
    messages: z.array(ChatMessageSchema).min(1),
    context: ChatRuntimeContextSchema.optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const ChatStartDataSchema = z
  .object({
    requestId: RuntimeIpcRequestIdSchema,
  })
  .strict();

export const ChatCancelPayloadSchema = z
  .object({
    targetRequestId: RuntimeIpcRequestIdSchema,
  })
  .strict();

export const ChatCancelDataSchema = z
  .object({
    cancelled: z.boolean(),
  })
  .strict();

export const ChatStartRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.chat.start,
  ChatStartPayloadSchema,
);

export const ChatCancelRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.chat.cancel,
  ChatCancelPayloadSchema,
);

export const ChatStartResultSchema = createRuntimeIpcResultSchema(
  ChatStartDataSchema,
  IPC_CHANNELS.chat.start,
);

export const ChatCancelResultSchema = createRuntimeIpcResultSchema(
  ChatCancelDataSchema,
  IPC_CHANNELS.chat.cancel,
);

export const AgentSessionCreatePayloadSchema = z
  .object({
    title: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
    workspacePath: z.string().min(1).optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const AgentSessionCreateDataSchema = z.object({ session: AgentSessionSchema }).strict();

export const AgentSessionListPayloadSchema = z.object({}).strict();

export const AgentSessionListDataSchema = z
  .object({
    sessions: z.array(AgentSessionSchema),
  })
  .strict();

export const AgentRunStartPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    triggerMessageId: z.string().min(1).optional(),
    goal: z.string().min(1),
    mode: z.string().min(1),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const AgentRunStartDataSchema = z
  .object({
    run: AgentRunSchema,
    message: MessageSchema.optional(),
  })
  .strict();

export const AgentSessionCreateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.session.create,
  AgentSessionCreatePayloadSchema,
);

export const AgentSessionListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.session.list,
  AgentSessionListPayloadSchema,
);

export const AgentRunStartRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.run.start,
  AgentRunStartPayloadSchema,
);

export const AgentSessionCreateResultSchema = createRuntimeIpcResultSchema(
  AgentSessionCreateDataSchema,
  IPC_CHANNELS.agent.session.create,
);

export const AgentSessionListResultSchema = createRuntimeIpcResultSchema(
  AgentSessionListDataSchema,
  IPC_CHANNELS.agent.session.list,
);

export const AgentRunStartResultSchema = createRuntimeIpcResultSchema(
  AgentRunStartDataSchema,
  IPC_CHANNELS.agent.run.start,
);

export type ProviderListPayload = z.infer<typeof ProviderListPayloadSchema>;
export type ProviderListData = z.infer<typeof ProviderListDataSchema>;
export type ProviderUpdatePayload = z.infer<typeof ProviderUpdatePayloadSchema>;
export type ProviderApiKeyPayload = z.infer<typeof ProviderApiKeyPayloadSchema>;
export type ProviderDeleteApiKeyPayload = z.infer<typeof ProviderDeleteApiKeyPayloadSchema>;
export type ProviderEmptyData = z.infer<typeof ProviderEmptyDataSchema>;
export type ChatStartPayload = z.infer<typeof ChatStartPayloadSchema>;
export type ChatStartData = z.infer<typeof ChatStartDataSchema>;
export type ChatCancelPayload = z.infer<typeof ChatCancelPayloadSchema>;
export type ChatCancelData = z.infer<typeof ChatCancelDataSchema>;
export type AgentSessionCreatePayload = z.infer<typeof AgentSessionCreatePayloadSchema>;
export type AgentSessionCreateData = z.infer<typeof AgentSessionCreateDataSchema>;
export type AgentSessionListPayload = z.infer<typeof AgentSessionListPayloadSchema>;
export type AgentSessionListData = z.infer<typeof AgentSessionListDataSchema>;
export type AgentRunStartPayload = z.infer<typeof AgentRunStartPayloadSchema>;
export type AgentRunStartData = z.infer<typeof AgentRunStartDataSchema>;
