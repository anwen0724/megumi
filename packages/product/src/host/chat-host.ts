/*
 * Adapts the Chat Host contract to the already-composed Product chat entry.
 * Cross-Package input and query orchestration remains in input-submission.ts.
 */
import type { ProductChat } from '../chat';
import type { ChatHost } from './chat-contract';

export function createChatHost(chat: ProductChat): ChatHost {
  return {
    createSession: (request) => chat.createSession(request),
    listSessions: (request) => chat.listSessions(request),
    listMessages: (request) => chat.listMessages(request),
    listTimeline: (request) => chat.listTimeline(request),
    sendUserInput: (request) => chat.submit(request),
    cancelUserInput: (request) => chat.cancelUserInput(request),
    createBranchDraft: (request) => chat.createBranchDraft(request),
    cancelBranchDraft: (request) => chat.cancelBranchDraft(request),
    getCommandSuggestions: (request) => chat.getCommandSuggestions(request),
    listRuns: (request) => chat.listRuns(request),
    listRunEvents: (request) => chat.listRunEvents(request),
    getSessionHydration: (request) => chat.getSessionHydration(request),
    getContextUsage: (request) => chat.getContextUsage(request),
    getInputCapabilities: () => chat.getInputCapabilities(),
    selectImages: () => chat.selectImages(),
    selectDocuments: () => chat.selectDocuments(),
    readClipboardImage: () => chat.readClipboardImage(),
    readAttachmentImage: (request) => chat.readAttachmentImage(request),
    getAttachmentFileStatus: (request) => chat.getAttachmentFileStatus(request),
  };
}
