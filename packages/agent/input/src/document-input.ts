/*
 * Resolves and validates one document reference without reading its contents.
 */
import path from "node:path";
import type { InputFailure, RawDocumentInput } from "./input";
import type { DocumentInputPolicy, SupportedDocumentMediaType } from "./input-policy";
import type { InputSourceAccess } from "./input-source";

const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, SupportedDocumentMediaType>> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
};

export interface DocumentInput {
  readonly draftAttachmentId: string;
  readonly type: "file";
  readonly name: string;
  readonly mediaType: SupportedDocumentMediaType;
  readonly localPath: string;
  readonly sizeBytes: number;
}

export async function processDocumentInput(input: {
  readonly document: RawDocumentInput;
  readonly sourceAccess: InputSourceAccess;
  readonly policy: DocumentInputPolicy;
  readonly signal?: AbortSignal;
}): Promise<
  | { readonly status: "accepted"; readonly document: DocumentInput }
  | { readonly status: "failed"; readonly failure: InputFailure }
> {
  if (input.signal?.aborted) return cancelledFailure();
  let resolved: { readonly path: string; readonly sizeBytes: number };
  try {
    resolved = await input.sourceAccess.resolveDocument(input.document.source, { signal: input.signal });
  } catch (error) {
    if (input.signal?.aborted || isAbortError(error)) return cancelledFailure();
    return failure("document_reference_unavailable", `Document ${safeName(input.document.name, "document")} is no longer available.`);
  }
  if (input.signal?.aborted) return cancelledFailure();
  if (resolved.sizeBytes > input.policy.maxDocumentBytes) {
    return failure("document_too_large", `Document ${safeName(input.document.name, "document")} exceeds the per-document size limit.`);
  }
  const mediaType = mediaTypeForPath(resolved.path);
  if (!mediaType || !input.policy.allowedMediaTypes.includes(mediaType)) {
    return failure("document_format_unsupported", `Document ${safeName(input.document.name, "document")} is not a supported PDF, DOCX, TXT, or Markdown file.`);
  }
  if (input.document.declaredMimeType && input.document.declaredMimeType !== mediaType) {
    return failure("document_mime_mismatch", `Document ${safeName(input.document.name, "document")} does not match its declared media type.`);
  }
  return {
    status: "accepted",
    document: {
      draftAttachmentId: input.document.draftAttachmentId,
      type: "file",
      name: safeName(input.document.name ?? path.basename(resolved.path), "document"),
      mediaType,
      localPath: path.resolve(resolved.path),
      sizeBytes: resolved.sizeBytes,
    },
  };
}

export function mediaTypeForPath(filePath: string): SupportedDocumentMediaType | undefined {
  return MEDIA_TYPE_BY_EXTENSION[path.extname(filePath).toLowerCase()];
}

function safeName(name: string | undefined, fallback: string): string {
  const leaf = (name ?? fallback).split(/[\\/]/).at(-1) ?? fallback;
  return leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255) || fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function cancelledFailure() {
  return failure("input_cancelled", "Input processing was cancelled.");
}

function failure(code: InputFailure["code"], message: string) {
  return { status: "failed" as const, failure: { code, message } };
}
