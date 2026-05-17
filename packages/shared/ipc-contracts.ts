import { z } from 'zod';
import type { IsoDateTime } from './ids';
import { IPC_CHANNELS } from './ipc-channels';
import { RuntimeIpcErrorSchema, type RuntimeIpcError } from './ipc-errors';
import { RuntimeContextSchema, RuntimeResultMetaSchema, type RuntimeContext } from './runtime-context';
import { IsoDateTimeSchema, RuntimeIdSchema } from './runtime-validation';

export { IsoDateTimeSchema };

export const BUSINESS_IPC_CHANNELS = [
  IPC_CHANNELS.provider.list,
  IPC_CHANNELS.provider.update,
  IPC_CHANNELS.provider.setApiKey,
  IPC_CHANNELS.provider.deleteApiKey,
  IPC_CHANNELS.session.create,
  IPC_CHANNELS.session.list,
  IPC_CHANNELS.session.message.send,
  IPC_CHANNELS.session.message.cancel,
  IPC_CHANNELS.run.events.list,
  IPC_CHANNELS.runContext.baselineGet,
  IPC_CHANNELS.runContext.sourcesList,
  IPC_CHANNELS.plan.byRunGet,
  IPC_CHANNELS.plan.statusUpdate,
  IPC_CHANNELS.tool.definitionsList,
  IPC_CHANNELS.tool.callGet,
  IPC_CHANNELS.approval.resolve,
  IPC_CHANNELS.recovery.recoverableRunsList,
  IPC_CHANNELS.recovery.resume,
  IPC_CHANNELS.recovery.cancel,
  IPC_CHANNELS.recovery.retry,
  IPC_CHANNELS.artifacts.listByRun,
  IPC_CHANNELS.artifacts.listBySession,
  IPC_CHANNELS.artifacts.get,
  IPC_CHANNELS.artifacts.versionGet,
  IPC_CHANNELS.artifacts.versionCreate,
  IPC_CHANNELS.artifacts.statusUpdate,
  IPC_CHANNELS.artifacts.reference,
  IPC_CHANNELS.memory.settingsGet,
  IPC_CHANNELS.memory.settingsUpdate,
  IPC_CHANNELS.memory.candidateList,
  IPC_CHANNELS.memory.candidateAccept,
  IPC_CHANNELS.memory.candidateReject,
  IPC_CHANNELS.memory.candidateArchive,
  IPC_CHANNELS.memory.candidateEditAndAccept,
  IPC_CHANNELS.memory.memoryList,
  IPC_CHANNELS.memory.memoryGet,
  IPC_CHANNELS.memory.memoryUpdate,
  IPC_CHANNELS.memory.memoryArchive,
  IPC_CHANNELS.memory.memoryDelete,
  IPC_CHANNELS.memory.memoryDisable,
  IPC_CHANNELS.memory.memoryEnable,
  IPC_CHANNELS.memory.sourceRefsList,
  IPC_CHANNELS.memory.accessLogsList,
  IPC_CHANNELS.memory.recallPreview,
] as const;

export type BusinessIpcChannel = (typeof BUSINESS_IPC_CHANNELS)[number];

const BUSINESS_IPC_CHANNEL_VALUES = [...BUSINESS_IPC_CHANNELS] as [
  BusinessIpcChannel,
  ...BusinessIpcChannel[],
];

export const BusinessIpcChannelSchema = z.enum(BUSINESS_IPC_CHANNEL_VALUES);

export const RuntimeIpcRequestIdSchema = RuntimeIdSchema;

export const RuntimeIpcRequestMetaSchema = z
  .object({
    channel: BusinessIpcChannelSchema,
    createdAt: IsoDateTimeSchema,
    source: z.literal('renderer'),
  })
  .strict();

export const RuntimeIpcResponseMetaSchema = RuntimeResultMetaSchema.extend({
  requestId: RuntimeIpcRequestIdSchema,
  channel: BusinessIpcChannelSchema,
}).strict();

export interface RuntimeIpcRequestMeta<TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  channel: TChannel;
  createdAt: IsoDateTime;
  source: 'renderer';
}

export interface RuntimeIpcRequest<TPayload, TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  requestId: string;
  payload: TPayload;
  meta: RuntimeIpcRequestMeta<TChannel>;
  context?: RuntimeContext;
}

export interface RuntimeIpcResponseMeta<TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  requestId: string;
  channel: TChannel;
  traceId?: string;
  debugId?: string;
  operationName?: string;
  handledAt: IsoDateTime;
  durationMs?: number;
}

export interface RuntimeIpcSuccess<TData extends object, TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  ok: true;
  data: TData;
  meta: RuntimeIpcResponseMeta<TChannel>;
}

export interface RuntimeIpcFailure<TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  ok: false;
  error: RuntimeIpcError;
  meta: RuntimeIpcResponseMeta<TChannel>;
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
    z
      .object({
        ok: z.literal(true),
        data: dataSchema,
        meta: metaSchema,
      })
      .strict(),
    z
      .object({
        ok: z.literal(false),
        error: RuntimeIpcErrorSchema,
        meta: metaSchema,
      })
      .strict(),
  ]);
}

export function isBusinessIpcChannel(value: string): value is BusinessIpcChannel {
  return (BUSINESS_IPC_CHANNELS as readonly string[]).includes(value);
}
