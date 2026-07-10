/*
 * Desktop IPC request and response envelope contracts.
 */
import { z } from 'zod';
import {
  RuntimeContextSchema,
  RuntimeIdSchema,
  RuntimeResultMetaSchema,
  type RuntimeContext,
} from '@megumi/coding-agent/events';
import { IPC_CHANNELS } from './channels';
import { RuntimeIpcErrorSchema, type RuntimeIpcError } from './errors';
export type { RuntimeIpcError } from './errors';

export const BUSINESS_IPC_CHANNELS = [
  IPC_CHANNELS.settings.get,
  IPC_CHANNELS.settings.update,
  IPC_CHANNELS.settings.providerList,
  IPC_CHANNELS.settings.providerUpdate,
  IPC_CHANNELS.settings.providerDelete,
  IPC_CHANNELS.settings.providerSetApiKey,
  IPC_CHANNELS.settings.providerDeleteApiKey,
  IPC_CHANNELS.chat.commandSuggestions,
  IPC_CHANNELS.chat.sessionCreate,
  IPC_CHANNELS.chat.sessionList,
  IPC_CHANNELS.chat.sessionMessageList,
  IPC_CHANNELS.chat.sessionMessageSend,
  IPC_CHANNELS.chat.sessionMessageCancel,
  IPC_CHANNELS.chat.sessionTimelineList,
  IPC_CHANNELS.chat.sessionContextUsageGet,
  IPC_CHANNELS.chat.branchDraftCreate,
  IPC_CHANNELS.chat.branchDraftCancel,
  IPC_CHANNELS.chat.runListBySession,
  IPC_CHANNELS.chat.runEventsList,
  IPC_CHANNELS.skill.list,
  IPC_CHANNELS.skill.get,
  IPC_CHANNELS.skill.enable,
  IPC_CHANNELS.skill.disable,
  IPC_CHANNELS.approval.resolve,
  IPC_CHANNELS.workspace.projectList,
  IPC_CHANNELS.workspace.projectUseExisting,
  IPC_CHANNELS.workspace.projectOpen,
  IPC_CHANNELS.workspace.projectRemove,
  IPC_CHANNELS.workspace.filesList,
  IPC_CHANNELS.workspace.filesOpen,
  IPC_CHANNELS.artifacts.listByRun,
  IPC_CHANNELS.artifacts.listBySession,
  IPC_CHANNELS.artifacts.get,
  IPC_CHANNELS.artifacts.versionGet,
  IPC_CHANNELS.artifacts.versionCreate,
  IPC_CHANNELS.artifacts.statusUpdate,
  IPC_CHANNELS.artifacts.reference,
] as const;

export type BusinessIpcChannel = (typeof BUSINESS_IPC_CHANNELS)[number];

export const BusinessIpcChannelSchema = z.enum([...BUSINESS_IPC_CHANNELS] as [
  BusinessIpcChannel,
  ...BusinessIpcChannel[],
]);

export const RuntimeIpcRequestIdSchema = RuntimeIdSchema;

export const RuntimeIpcRequestMetaSchema = z
  .object({
    channel: BusinessIpcChannelSchema,
    createdAt: z.string().datetime(),
    source: z.literal('renderer'),
  })
  .strict();

export const RuntimeIpcResponseMetaSchema = RuntimeResultMetaSchema.extend({
  requestId: RuntimeIpcRequestIdSchema,
  channel: BusinessIpcChannelSchema,
}).strict();

export interface RuntimeIpcRequest<TPayload, TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  requestId: string;
  payload: TPayload;
  meta: {
    channel: TChannel;
    createdAt: string;
    source: 'renderer';
  };
  context?: RuntimeContext;
}

export interface RuntimeIpcSuccess<TData extends object, TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  ok: true;
  data: TData;
  meta: z.infer<typeof RuntimeIpcResponseMetaSchema> & { channel: TChannel };
}

export interface RuntimeIpcFailure<TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  ok: false;
  error: RuntimeIpcError;
  meta: z.infer<typeof RuntimeIpcResponseMetaSchema> & { channel: TChannel };
}

export type RuntimeIpcResult<
  TData extends object,
  TChannel extends BusinessIpcChannel = BusinessIpcChannel,
> = RuntimeIpcSuccess<TData, TChannel> | RuntimeIpcFailure<TChannel>;

export function createRuntimeIpcRequestSchema<TPayload extends z.ZodTypeAny, TChannel extends BusinessIpcChannel>(
  channel: TChannel,
  payloadSchema: TPayload,
) {
  return z
    .object({
      requestId: RuntimeIpcRequestIdSchema,
      payload: payloadSchema,
      meta: RuntimeIpcRequestMetaSchema.extend({
        channel: z.literal(channel),
      }).strict(),
      context: RuntimeContextSchema.optional(),
    })
    .strict();
}

export function createRuntimeIpcResultSchema<TData extends z.ZodTypeAny, TChannel extends BusinessIpcChannel>(
  dataSchema: TData,
  channel?: TChannel,
) {
  const metaSchema = channel
    ? RuntimeIpcResponseMetaSchema.extend({ channel: z.literal(channel) }).strict()
    : RuntimeIpcResponseMetaSchema;

  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data: dataSchema, meta: metaSchema }).strict(),
    z.object({ ok: z.literal(false), error: RuntimeIpcErrorSchema, meta: metaSchema }).strict(),
  ]);
}
