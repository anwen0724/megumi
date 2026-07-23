/* Resolves and validates selected document references without copying content. */
import path from 'node:path';
import type {
  ProcessedInputDocument,
  RawUserInputDocument,
  SupportedDocumentMediaType,
} from '../../domain/model/document-input';
import {
  DOCUMENT_INPUT_POLICY,
  type DocumentInputPolicy,
} from '../../domain/model/document-input-policy';
import type { InputFailure } from '../../domain/model/user-input';
import type { InputFileReader } from '../input-service-types';

const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, SupportedDocumentMediaType>> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
};

export async function processInputDocuments(input: {
  documents: RawUserInputDocument[];
  fileReader: InputFileReader;
  policy?: DocumentInputPolicy;
}): Promise<
  | { status: 'ok'; documents: ProcessedInputDocument[] }
  | { status: 'failed'; failure: InputFailure }
> {
  const policy = input.policy ?? DOCUMENT_INPUT_POLICY;
  if (input.documents.length > policy.maxDocumentCount) {
    return failure(
      'document_count_exceeded',
      `A maximum of ${policy.maxDocumentCount} documents can be sent at once.`,
    );
  }

  const processed: ProcessedInputDocument[] = [];
  for (const document of input.documents) {
    if (!input.fileReader.resolveLocalFile) {
      return failure('document_reference_unavailable', 'Document input is unavailable in this host.');
    }
    let resolved: { path: string; sizeBytes: number };
    try {
      resolved = await input.fileReader.resolveLocalFile(document.source);
    } catch {
      return failure(
        'document_reference_unavailable',
        `Document ${safeName(document.name)} is no longer available.`,
      );
    }
    if (resolved.sizeBytes > policy.maxDocumentBytes) {
      return failure(
        'document_too_large',
        `Document ${safeName(document.name)} exceeds the per-document size limit.`,
      );
    }

    const mediaType = mediaTypeForPath(resolved.path);
    if (!mediaType || !policy.allowedMediaTypes.includes(mediaType)) {
      return failure(
        'document_format_unsupported',
        `Document ${safeName(document.name)} is not a supported PDF, DOCX, TXT, or Markdown file.`,
      );
    }
    if (document.declared_mime_type && document.declared_mime_type !== mediaType) {
      return failure(
        'document_mime_mismatch',
        `Document ${safeName(document.name)} does not match its declared media type.`,
      );
    }

    processed.push({
      draft_attachment_id: document.draft_attachment_id,
      type: 'file',
      name: safeName(document.name ?? path.basename(resolved.path)),
      media_type: mediaType,
      local_path: path.resolve(resolved.path),
      size_bytes: resolved.sizeBytes,
    });
  }
  return { status: 'ok', documents: processed };
}

export function mediaTypeForPath(filePath: string): SupportedDocumentMediaType | undefined {
  return MEDIA_TYPE_BY_EXTENSION[path.extname(filePath).toLowerCase()];
}

function safeName(name?: string): string {
  const leaf = (name ?? 'document').split(/[\\/]/).at(-1) ?? 'document';
  return leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255) || 'document';
}

function failure(code: InputFailure['code'], message: string) {
  return { status: 'failed' as const, failure: { code, message } };
}
