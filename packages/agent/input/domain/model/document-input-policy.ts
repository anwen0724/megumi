/* Defines the first-version document attachment policy owned by Input. */
import type { SupportedDocumentMediaType } from './document-input';

export type DocumentInputPolicy = {
  allowedMediaTypes: readonly SupportedDocumentMediaType[];
  maxDocumentCount: number;
  maxDocumentBytes: number;
};

export const DOCUMENT_INPUT_POLICY: DocumentInputPolicy = Object.freeze({
  allowedMediaTypes: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
  ] as const,
  maxDocumentCount: 10,
  maxDocumentBytes: 50 * 1024 * 1024,
});
