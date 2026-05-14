import { z } from 'zod';
import {
  createRuntimeIpcRequestSchema,
  createRuntimeIpcResultSchema,
  IsoDateTimeSchema,
  RuntimeIpcRequestIdSchema,
} from './ipc-contracts';
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
