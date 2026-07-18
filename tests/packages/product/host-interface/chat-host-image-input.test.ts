/* Verifies that ChatHost only projects image-owner capabilities and attachment content. */
import { describe, expect, it, vi } from 'vitest';
import { IMAGE_INPUT_POLICY } from '@megumi/agent/input';
import { createChatHost } from '@megumi/product/host-interface/chat-host';

function createHost(input: {
  selectImages?: () => Promise<{ status: 'cancelled' }>;
  readClipboardImage?: () => Promise<{ status: 'cancelled' }>;
  readAttachmentContent?: (request: { attachment_id: string }) => Promise<unknown>;
} = {}) {
  const readAttachmentContent = vi.fn(input.readAttachmentContent ?? (async () => ({
    status: 'ok' as const,
    content: {
      media_type: 'image/png' as const,
      bytes: new Uint8Array([1, 2, 3]),
    },
  })));

  return {
    host: createChatHost({
      agentRunService: {} as never,
      commandService: { getCommandSuggestions: vi.fn() },
      sessionService: { readAttachmentContent } as never,
      workspaceService: { listWorkspaces: async () => ({ workspaces: [] }) },
      branchService: {
        createBranchDraft: vi.fn() as never,
        cancelBranchDraft: vi.fn() as never,
      },
      sessionTimelineQuery: { listSessionTimeline: vi.fn() as never },
      contextService: { getSessionUsageSnapshot: vi.fn() },
      ...(input.selectImages || input.readClipboardImage ? {
        imagePicker: {
          selectImages: input.selectImages ?? (async () => ({ status: 'cancelled' as const })),
          readClipboardImage: input.readClipboardImage ?? (async () => ({ status: 'cancelled' as const })),
        },
      } : {}),
    }),
    readAttachmentContent,
  };
}

describe('ChatHost image input', () => {
  it('mechanically projects the Input-owned policy', () => {
    const { host } = createHost();

    expect(host.getInputCapabilities()).toEqual({
      allowedMediaTypes: [...IMAGE_INPUT_POLICY.allowedMediaTypes],
      maxImageCount: IMAGE_INPUT_POLICY.maxImageCount,
      maxImageBytes: IMAGE_INPUT_POLICY.maxImageBytes,
      maxTotalBytes: IMAGE_INPUT_POLICY.maxTotalBytes,
    });
  });

  it('delegates selection to the injected host capability', async () => {
    const selectImages = vi.fn(async () => ({ status: 'cancelled' as const }));
    const { host } = createHost({ selectImages });

    await expect(host.selectImages()).resolves.toEqual({ status: 'cancelled' });
    expect(selectImages).toHaveBeenCalledTimes(1);
  });

  it('delegates clipboard image reads to the injected host capability', async () => {
    const readClipboardImage = vi.fn(async () => ({ status: 'cancelled' as const }));
    const { host } = createHost({ readClipboardImage });

    await expect(host.readClipboardImage()).resolves.toEqual({ status: 'cancelled' });
    expect(readClipboardImage).toHaveBeenCalledTimes(1);
  });

  it('projects Session-owned bytes without exposing a managed path', async () => {
    const { host, readAttachmentContent } = createHost();

    await expect(host.readAttachmentImage({ attachmentId: 'attachment:1' })).resolves.toEqual({
      status: 'ok',
      dataUrl: 'data:image/png;base64,AQID',
    });
    expect(readAttachmentContent).toHaveBeenCalledWith({ attachment_id: 'attachment:1' });
  });
});
