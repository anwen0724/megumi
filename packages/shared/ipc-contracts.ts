import { z } from 'zod';
import type { IsoDateTime } from './ids';
import { IPC_CHANNELS } from './ipc-channels';
import { RuntimeIpcErrorSchema, type RuntimeIpcError } from './ipc-errors';

export const BUSINESS_IPC_CHANNELS = [
  IPC_CHANNELS.provider.list,
  IPC_CHANNELS.provider.update,
  IPC_CHANNELS.provider.setApiKey,
  IPC_CHANNELS.provider.deleteApiKey,
  IPC_CHANNELS.chat.start,
  IPC_CHANNELS.chat.cancel,
] as const;

export type BusinessIpcChannel = (typeof BUSINESS_IPC_CHANNELS)[number];

const BUSINESS_IPC_CHANNEL_VALUES = [...BUSINESS_IPC_CHANNELS] as [
  BusinessIpcChannel,
  ...BusinessIpcChannel[],
];

export const BusinessIpcChannelSchema = z.enum(BUSINESS_IPC_CHANNEL_VALUES);

export const RuntimeIpcRequestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/, 'Request id must contain only letters, numbers, colon, underscore, or hyphen.');

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const RuntimeIpcRequestMetaSchema = z
  .object({
    channel: BusinessIpcChannelSchema,
    createdAt: IsoDateTimeSchema,
    source: z.literal('renderer'),
  })
  .strict();

export const RuntimeIpcResponseMetaSchema = z
  .object({
    requestId: RuntimeIpcRequestIdSchema,
    channel: BusinessIpcChannelSchema,
    handledAt: IsoDateTimeSchema,
    durationMs: z.number().nonnegative().optional(),
  })
  .strict();

export interface RuntimeIpcRequestMeta<TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  channel: TChannel;
  createdAt: IsoDateTime;
  source: 'renderer';
}

export interface RuntimeIpcRequest<TPayload, TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  requestId: string;
  payload: TPayload;
  meta: RuntimeIpcRequestMeta<TChannel>;
}

export interface RuntimeIpcResponseMeta<TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  requestId: string;
  channel: TChannel;
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
