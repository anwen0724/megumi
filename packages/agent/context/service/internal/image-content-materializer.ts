/* Resolves Session-owned image references before product facts become an AI Context. */
import type { ModelSupportLevel } from '../../../model-capability';
import { encodeBase64, type ContentBlock } from '../../../model-content';
import type { SessionService } from '../../../session';
import type { ActiveContext } from '../../domain/model/active-context';
import type { ConversationItem } from '../../domain/model/conversation-run';
import type { ContextFailure } from '../context-service-types';

type AttachmentReader = Pick<SessionService, 'readAttachmentContent'>;

export async function materializeActiveContextImages(input: {
  activeContext: ActiveContext;
  sessionService: AttachmentReader;
  imageInputSupport: ModelSupportLevel;
}): Promise<
  | { status: 'materialized'; activeContext: ActiveContext }
  | { status: 'failed'; failure: ContextFailure }
> {
  try {
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
          runItems: await materializeConversationItems(input.activeContext.currentRun.runItems, materialize),
        }
      : undefined;
    const memoryRecall = input.activeContext.referenceContext.memoryRecall
      ? {
          ...input.activeContext.referenceContext.memoryRecall,
          items: await Promise.all(input.activeContext.referenceContext.memoryRecall.items.map(async (item) => ({
            ...item,
            content: await materialize(item.content),
          }))),
        }
      : undefined;

    return {
      status: 'materialized',
      activeContext: {
        ...input.activeContext,
        historicalRuns,
        ...(currentRun ? { currentRun } : {}),
        referenceContext: {
          ...input.activeContext.referenceContext,
          ...(memoryRecall ? { memoryRecall } : {}),
        },
      },
    };
  } catch (error) {
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
  sessionService: AttachmentReader;
  imageInputSupport: ModelSupportLevel;
}): (blocks: ContentBlock[]) => Promise<ContentBlock[]> {
  return (blocks) => Promise.all(blocks.map(async (block) => {
    if (block.type !== 'image' || block.source.type !== 'host_reference') return block;
    if (input.imageInputSupport === false) {
      return {
        type: 'text' as const,
        text: '[An image was attached, but the selected model cannot view image content.]',
      };
    }
    const read = await input.sessionService.readAttachmentContent({ attachment_id: block.source.referenceId });
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
  return Promise.all(items.map(async (item) => {
    if (item.type === 'tool_result') return { ...item, content: await materialize(item.content) };
    return item;
  }));
}

class AttachmentMaterializationError extends Error {
  constructor(readonly ownerCode: string, message: string) {
    super(message);
  }
}
