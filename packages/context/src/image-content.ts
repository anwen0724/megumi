/* Materializes Session-owned image references only when the selected Model can consume them. */
import type { ContentBlock, ModelSupportLevel } from '@megumi/ai';
import type { SessionAttachmentReader } from '@megumi/session';
import type { ActiveContext } from './active-context';
import type { ConversationItem } from './conversation-run';

export type ImageMaterializationFailure =
  | {
      readonly code: 'image_materialization_failed';
      readonly message: string;
      readonly retryable: false;
      readonly cause: { readonly owner: 'session'; readonly code?: string };
    }
  | {
      readonly code: 'cancelled';
      readonly message: string;
      readonly retryable: true;
    };

export async function materializeActiveContextImages(input: {
  readonly activeContext: ActiveContext;
  readonly attachmentReader: Pick<SessionAttachmentReader, 'readAttachmentContent'>;
  readonly imageInputSupport: ModelSupportLevel;
  readonly signal?: AbortSignal;
}): Promise<
  | { readonly status: 'materialized'; readonly activeContext: ActiveContext }
  | { readonly status: 'failed'; readonly failure: ImageMaterializationFailure }
> {
  try {
    throwIfCancelled(input.signal);
    const materialize = createBlockMaterializer(input);
    const historicalRuns = await Promise.all(input.activeContext.historicalRuns.map(async (run) => ({
      ...run,
      userMessage: { ...run.userMessage, content: await materialize(run.userMessage.content) },
      items: await materializeConversationItems(run.items, materialize),
    })));
    const currentRun = input.activeContext.currentRun
      ? {
          ...input.activeContext.currentRun,
          userMessage: {
            ...input.activeContext.currentRun.userMessage,
            content: await materialize(input.activeContext.currentRun.userMessage.content),
          },
          runItems: await materializeConversationItems(
            input.activeContext.currentRun.runItems,
            materialize,
          ),
        }
      : undefined;
    throwIfCancelled(input.signal);
    return {
      status: 'materialized',
      activeContext: {
        ...input.activeContext,
        historicalRuns,
        ...(currentRun ? { currentRun } : {}),
      },
    };
  } catch (error) {
    if (error instanceof ContextImageCancellationError) {
      return { status: 'failed', failure: cancelled() };
    }
    return {
      status: 'failed',
      failure: {
        code: 'image_materialization_failed',
        message: error instanceof Error ? error.message : 'Image content could not be materialized.',
        retryable: false,
        cause: {
          owner: 'session',
          ...(error instanceof AttachmentMaterializationError ? { code: error.ownerCode } : {}),
        },
      },
    };
  }
}

function createBlockMaterializer(input: {
  readonly attachmentReader: Pick<SessionAttachmentReader, 'readAttachmentContent'>;
  readonly imageInputSupport: ModelSupportLevel;
  readonly signal?: AbortSignal;
}): (blocks: ContentBlock[]) => Promise<ContentBlock[]> {
  return (blocks) => Promise.all(blocks.map(async (block) => {
    throwIfCancelled(input.signal);
    if (block.type !== 'image' || block.source.type !== 'host_reference') return block;
    if (input.imageInputSupport === false) {
      return {
        type: 'text' as const,
        text: '[An image was attached, but the selected model cannot view image content.]',
      };
    }
    const read = await input.attachmentReader.readAttachmentContent({
      attachment_id: block.source.referenceId,
    });
    throwIfCancelled(input.signal);
    if (read.status === 'failed') {
      throw new AttachmentMaterializationError(read.failure.code, read.failure.message);
    }
    return {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        mediaType: read.content.media_type,
        data: encodeBase64(read.content.bytes),
      },
    };
  }));
}

async function materializeConversationItems(
  items: Exclude<ConversationItem, { type: 'user_message' }>[],
  materialize: (blocks: ContentBlock[]) => Promise<ContentBlock[]>,
): Promise<Exclude<ConversationItem, { type: 'user_message' }>[]> {
  return Promise.all(items.map(async (item) => (
    item.type === 'tool_result'
      ? { ...item, content: await materialize(item.content) }
      : item
  )));
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeBase64(bytes: Uint8Array): string {
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const remaining = bytes.length - index;
    encoded += BASE64_ALPHABET[first >> 2];
    encoded += BASE64_ALPHABET[((first & 0b11) << 4) | (second >> 4)];
    encoded += remaining > 1
      ? BASE64_ALPHABET[((second & 0b1111) << 2) | (third >> 6)]
      : '=';
    encoded += remaining > 2 ? BASE64_ALPHABET[third & 0b111111] : '=';
  }
  return encoded;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ContextImageCancellationError();
}

function cancelled(): ImageMaterializationFailure {
  return {
    code: 'cancelled',
    message: 'Context construction was cancelled.',
    retryable: true,
  };
}

class AttachmentMaterializationError extends Error {
  constructor(readonly ownerCode: string, message: string) {
    super(message);
  }
}

class ContextImageCancellationError extends Error {}
