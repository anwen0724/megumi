/* Verifies image references materialize or degrade according to Model capability. */
import type { ActiveContext } from '../../../packages/context/src/active-context';
import { materializeActiveContextImages } from '../../../packages/context/src/image-content';
import { describe, expect, it, vi } from 'vitest';

function activeContext(): ActiveContext {
  return {
    sessionId: 'session:1',
    executionEnvironment: {
      workingDirectory: '/workspace',
      operatingSystem: 'Linux',
      shell: 'POSIX shell',
    },
    systemInstructions: [],
    effectiveInstructions: { sources: [] },
    skillCatalog: [],
    usedSkills: [],
    historicalRuns: [],
    currentRun: {
      runId: 'run:1',
      userEntry: { entryId: 'entry:1' },
      userMessage: {
        type: 'user_message',
        content: [{
          type: 'image',
          source: { type: 'host_reference', referenceId: 'attachment:1' },
        }],
      },
      runItems: [],
    },
    tools: [],
  };
}

describe('materializeActiveContextImages', () => {
  it('reads managed bytes and emits provider-neutral Base64 content', async () => {
    const readAttachmentContent = vi.fn(async () => ({
      status: 'ok' as const,
      content: { bytes: new Uint8Array([72, 105]), media_type: 'image/png' as const },
    }));
    const result = await materializeActiveContextImages({
      activeContext: activeContext(),
      attachmentReader: { readAttachmentContent },
      imageInputSupport: true,
    });
    expect(result).toMatchObject({
      status: 'materialized',
      activeContext: {
        currentRun: {
          userMessage: {
            content: [{
              type: 'image',
              source: { type: 'base64', mediaType: 'image/png', data: 'SGk=' },
            }],
          },
        },
      },
    });
  });

  it('uses an explainable text fallback and does not read bytes for unsupported Models', async () => {
    const readAttachmentContent = vi.fn();
    const result = await materializeActiveContextImages({
      activeContext: activeContext(),
      attachmentReader: { readAttachmentContent },
      imageInputSupport: false,
    });
    expect(result).toMatchObject({
      status: 'materialized',
      activeContext: {
        currentRun: {
          userMessage: { content: [{ type: 'text', text: expect.stringContaining('cannot view') }] },
        },
      },
    });
    expect(readAttachmentContent).not.toHaveBeenCalled();
  });

  it('keeps cancellation distinct from attachment read failure', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await materializeActiveContextImages({
      activeContext: activeContext(),
      attachmentReader: { readAttachmentContent: vi.fn() },
      imageInputSupport: true,
      signal: controller.signal,
    })).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });

    expect(await materializeActiveContextImages({
      activeContext: activeContext(),
      attachmentReader: {
        readAttachmentContent: vi.fn(async () => ({
          status: 'failed' as const,
          failure: { code: 'attachment_content_missing', message: 'missing' },
        })),
      },
      imageInputSupport: true,
    })).toMatchObject({
      status: 'failed',
      failure: {
        code: 'image_materialization_failed',
        cause: { owner: 'session', code: 'attachment_content_missing' },
      },
    });
  });
});
