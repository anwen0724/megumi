/*
 * Desktop IPC request and response envelope contracts.
 */
import { z } from 'zod';
import { IPC_CHANNELS } from './channels';
import { RuntimeIpcErrorSchema, type RuntimeIpcError } from './errors';
export type { RuntimeIpcError } from './errors';

export const BUSINESS_IPC_CHANNELS = [
  IPC_CHANNELS.settings.get,
  IPC_CHANNELS.settings.update,
  IPC_CHANNELS.settings.completeSetup,
  IPC_CHANNELS.settings.providerList,
  IPC_CHANNELS.settings.providerUpdate,
  IPC_CHANNELS.settings.providerDelete,
  IPC_CHANNELS.settings.providerSetApiKey,
  IPC_CHANNELS.settings.providerDeleteApiKey,
  IPC_CHANNELS.session.inputSuggestions,
  IPC_CHANNELS.session.sessionCreate,
  IPC_CHANNELS.session.sessionList,
  IPC_CHANNELS.session.sessionMessageList,
  IPC_CHANNELS.session.sessionMessageSend,
  IPC_CHANNELS.session.sessionMessageCancel,
  IPC_CHANNELS.session.sessionRead,
  IPC_CHANNELS.session.committedRunRead,
  IPC_CHANNELS.session.sessionContextUsageGet,
  IPC_CHANNELS.session.inputCapabilitiesGet,
  IPC_CHANNELS.session.imageInputSelect,
  IPC_CHANNELS.session.documentInputSelect,
  IPC_CHANNELS.session.imageInputClipboardRead,
  IPC_CHANNELS.session.attachmentImageRead,
  IPC_CHANNELS.session.attachmentFileStatus,
  IPC_CHANNELS.session.branchDraftCreate,
  IPC_CHANNELS.session.branchDraftCancel,
  IPC_CHANNELS.skill.list,
  IPC_CHANNELS.skill.get,
  IPC_CHANNELS.skill.enable,
  IPC_CHANNELS.skill.disable,
  IPC_CHANNELS.skill.delete,
  IPC_CHANNELS.skill.refresh,
  IPC_CHANNELS.approval.resolve,
  IPC_CHANNELS.voice.snapshot,
  IPC_CHANNELS.voice.modelStatus,
  IPC_CHANNELS.voice.modelsCheckUpdates,
  IPC_CHANNELS.voice.modelsPrepare,
  IPC_CHANNELS.voice.modelsCancel,
  IPC_CHANNELS.voice.profilesList,
  IPC_CHANNELS.voice.profileImport,
  IPC_CHANNELS.voice.profileRename,
  IPC_CHANNELS.voice.profileRemove,
  IPC_CHANNELS.voice.profileSelect,
  IPC_CHANNELS.voice.profilePreview,
  IPC_CHANNELS.voice.sessionStart,
  IPC_CHANNELS.voice.sessionManualStart,
  IPC_CHANNELS.voice.sessionManualFinish,
  IPC_CHANNELS.voice.sessionMute,
  IPC_CHANNELS.voice.sessionInterrupt,
  IPC_CHANNELS.voice.sessionEnd,
  IPC_CHANNELS.workspace.projectList,
  IPC_CHANNELS.workspace.projectUseExisting,
  IPC_CHANNELS.workspace.projectOpen,
  IPC_CHANNELS.workspace.projectRemove,
  IPC_CHANNELS.workspace.filesList,
  IPC_CHANNELS.workspace.filesOpen,
  IPC_CHANNELS.observability.list,
  IPC_CHANNELS.observability.get,
  IPC_CHANNELS.observability.bundle,
] as const;

export type BusinessIpcChannel = (typeof BUSINESS_IPC_CHANNELS)[number];

export const BusinessIpcChannelSchema = z.enum([...BUSINESS_IPC_CHANNELS] as [
  BusinessIpcChannel,
  ...BusinessIpcChannel[],
]);

export const RuntimeIpcRequestIdSchema = z.string().min(1).max(128);

export const RuntimeIpcRequestMetaSchema = z
  .object({
    channel: BusinessIpcChannelSchema,
    createdAt: z.string().datetime(),
    source: z.literal('renderer'),
  })
  .strict();

export const RuntimeIpcResponseMetaSchema = z
  .object({
    requestId: RuntimeIpcRequestIdSchema,
    channel: BusinessIpcChannelSchema,
    handledAt: z.string().datetime(),
  })
  .strict();

export interface RuntimeIpcRequest<TPayload, TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  requestId: string;
  payload: TPayload;
  meta: {
    channel: TChannel;
    createdAt: string;
    source: 'renderer';
  };
}

export interface RuntimeIpcSuccess<TData extends object, TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  ok: true;
  data: TData;
  meta: z.infer<typeof RuntimeIpcResponseMetaSchema> & { channel: TChannel };
}

export interface RuntimeIpcFailure<TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  ok: false;
  data: RuntimeIpcError;
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
    z.object({ ok: z.literal(false), data: RuntimeIpcErrorSchema, meta: metaSchema }).strict(),
  ]);
}
