/* Verifies ChatHost attachment capability projection and safe local-file status checks. */
import { describe, expect, it, vi } from 'vitest';
import { DOCUMENT_INPUT_POLICY, IMAGE_INPUT_POLICY } from '@megumi/agent/input';
import { createChatHost } from '@megumi/product/host-interface/chat-host';

function createHost(input: {
  selectImages?: () => Promise<{ status: 'cancelled' }>;
  selectDocuments?: () => Promise<{ status: 'cancelled' }>;
  readClipboardImage?: () => Promise<{ status: 'cancelled' }>;
  readAttachmentContent?: (request: { attachment_id: string }) => Promise<unknown>;
  getAttachment?: (request: { attachment_id: string }) => unknown;
  fileExists?: (path: string) => Promise<boolean>;
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
      sessionService: {
        readAttachmentContent,
        getAttachment: input.getAttachment ?? (() => ({ status: 'not_found' as const })),
      } as never,
      workspaceService: { listWorkspaces: async () => ({ workspaces: [] }) },
      branchService: {
        createBranchDraft: vi.fn() as never,
        cancelBranchDraft: vi.fn() as never,
      },
      sessionTimelineQuery: { listSessionTimeline: vi.fn() as never },
      contextService: { getSessionUsageSnapshot: vi.fn() },
      ...(input.selectImages || input.selectDocuments || input.readClipboardImage ? {
        attachmentPicker: {
          selectImages: input.selectImages ?? (async () => ({ status: 'cancelled' as const })),
          selectDocuments: input.selectDocuments ?? (async () => ({ status: 'cancelled' as const })),
          readClipboardImage: input.readClipboardImage ?? (async () => ({ status: 'cancelled' as const })),
        },
      } : {}),
      ...(input.fileExists ? { localFileAvailability: { exists: input.fileExists } } : {}),
    }),
    readAttachmentContent,
  };
}

describe('ChatHost attachment input', () => {
  it('mechanically projects the Input-owned policy', () => {
    const { host } = createHost();

    expect(host.getInputCapabilities()).toEqual({
      allowedMediaTypes: [...IMAGE_INPUT_POLICY.allowedMediaTypes],
      maxImageCount: IMAGE_INPUT_POLICY.maxImageCount,
      maxImageBytes: IMAGE_INPUT_POLICY.maxImageBytes,
      maxTotalBytes: IMAGE_INPUT_POLICY.maxTotalBytes,
      allowedDocumentMediaTypes: [...DOCUMENT_INPUT_POLICY.allowedMediaTypes],
      maxDocumentCount: DOCUMENT_INPUT_POLICY.maxDocumentCount,
      maxDocumentBytes: DOCUMENT_INPUT_POLICY.maxDocumentBytes,
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

  it('delegates document selection to the same injected attachment capability', async () => {
    const selectDocuments = vi.fn(async () => ({ status: 'cancelled' as const }));
    const { host } = createHost({ selectDocuments });

    await expect(host.selectDocuments()).resolves.toEqual({ status: 'cancelled' });
    expect(selectDocuments).toHaveBeenCalledTimes(1);
  });

  it('projects Session-owned bytes without exposing a managed path', async () => {
    const { host, readAttachmentContent } = createHost();

    await expect(host.readAttachmentImage({ attachmentId: 'attachment:1' })).resolves.toEqual({
      status: 'ok',
      dataUrl: 'data:image/png;base64,AQID',
    });
    expect(readAttachmentContent).toHaveBeenCalledWith({ attachment_id: 'attachment:1' });
  });

  it('checks a Session-owned document path without returning that path to the UI', async () => {
    const fileExists = vi.fn(async () => true);
    const { host } = createHost({
      getAttachment: () => ({
        status: 'found',
        attachment: {
          attachment_id: 'attachment:document',
          message_id: 'message:1',
          session_id: 'session:1',
          type: 'file',
          source_type: 'local_file',
          source_value: 'C:/materials/notes.pdf',
          created_at: 'now',
        },
      }),
      fileExists,
    });

    await expect(host.getAttachmentFileStatus({
      attachmentId: 'attachment:document',
    })).resolves.toEqual({ status: 'available' });
    expect(fileExists).toHaveBeenCalledWith('C:/materials/notes.pdf');
  });
});
