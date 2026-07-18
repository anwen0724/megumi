/* Resolves Session-owned image references into complete model-facing Base64 blocks. */
import { encodeBase64, type AiModelSupportLevel, type ContentBlock } from '@megumi/ai';
import type { SessionService } from '../../../session';
import type { Prompt } from '../../domain/model/prompt';
import type { ContextFailure } from '../context-service-types';

type AttachmentReader = Pick<SessionService, 'readAttachmentContent'>;

export async function materializePromptImages(input: {
  prompt: Prompt;
  sessionService: AttachmentReader;
  imageInputSupport: AiModelSupportLevel;
}): Promise<{ status: 'materialized'; prompt: Prompt } | { status: 'failed'; failure: ContextFailure }> {
  try {
    const materializeBlocks = async (blocks: ContentBlock[]): Promise<ContentBlock[]> => Promise.all(
      blocks.map(async (block) => {
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
      }),
    );

    const conversation = await Promise.all(input.prompt.conversation.map(async (item) => {
      if (item.type === 'user_message' || item.type === 'assistant_message' || item.type === 'tool_result') {
        return { ...item, content: await materializeBlocks(item.content) };
      }
      return item;
    }));
    const memoryRecall = input.prompt.referenceContext.memoryRecall
      ? {
          ...input.prompt.referenceContext.memoryRecall,
          items: await Promise.all(input.prompt.referenceContext.memoryRecall.items.map(async (item) => ({
            ...item,
            content: await materializeBlocks(item.content),
          }))),
        }
      : undefined;

    return {
      status: 'materialized',
      prompt: {
        ...input.prompt,
        referenceContext: {
          ...input.prompt.referenceContext,
          ...(memoryRecall ? { memoryRecall } : {}),
        },
        conversation,
      },
    };
  } catch (error) {
    return {
      status: 'failed',
      failure: {
        code: 'image_materialization_failed',
        message: error instanceof Error ? error.message : 'Image content could not be materialized.',
        retryable: false,
        cause: { owner: 'session', ...(error instanceof AttachmentMaterializationError ? { code: error.ownerCode } : {}) },
      },
    };
  }
}

class AttachmentMaterializationError extends Error {
  constructor(readonly ownerCode: string, message: string) {
    super(message);
  }
}
