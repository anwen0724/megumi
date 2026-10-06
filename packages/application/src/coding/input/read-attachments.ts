/* Loads selected attachments before a Coding run starts. */
import type { DocumentInput } from './document-content';
import { processDocumentInput } from './document-content';
import type { ImageInput } from './image-content';
import { processImageInput } from './image-content';
import type { InputFailure, InputPolicy, RawInputAttachment } from './parse-message';

export type LocalImageSource = {
  readonly type: "local_file";
  readonly path: string;
};

export type HostFileReference = {
  readonly type: "host_file_reference";
  readonly referenceId: string;
};

export type RawImageSource = LocalImageSource | HostFileReference;

export type RawDocumentSource = HostFileReference;

export interface InputSourceAccess {
  readImage(source: RawImageSource, options?: InputSourceOperationOptions): Promise<Uint8Array>;
  resolveDocument(
    source: RawDocumentSource,
    options?: InputSourceOperationOptions,
  ): Promise<{ readonly path: string; readonly sizeBytes: number }>;
}

export interface InputSourceOperationOptions {
  readonly signal?: AbortSignal;
}

export type InputAttachment = ImageInput | DocumentInput;

export async function processInputAttachments(input: {
  readonly attachments: readonly RawInputAttachment[];
  readonly sourceAccess: InputSourceAccess;
  readonly policy: InputPolicy;
  readonly signal?: AbortSignal;
}): Promise<
  | { readonly status: "accepted"; readonly attachments: InputAttachment[] }
  | { readonly status: "failed"; readonly failure: InputFailure }
> {
  if (input.signal?.aborted) return cancelledFailure();
  const invalidId = invalidAttachmentId(input.attachments);
  if (invalidId !== undefined) {
    return {
      status: "failed",
      failure: {
        code: "attachment_identity_conflict",
        message: "Attachment identity must not be empty.",
        details: { draftAttachmentId: invalidId },
      },
    };
  }
  const duplicateId = duplicateAttachmentId(input.attachments);
  if (duplicateId) {
    return {
      status: "failed",
      failure: {
        code: "attachment_identity_conflict",
        message: `Attachment identity is duplicated: ${duplicateId}`,
        details: { draftAttachmentId: duplicateId },
      },
    };
  }
  const imageCount = input.attachments.filter((attachment) => attachment.type === "image").length;
  if (imageCount > input.policy.image.maxImageCount) {
    return failure("image_count_exceeded", `A maximum of ${input.policy.image.maxImageCount} images can be sent at once.`);
  }
  const documentCount = input.attachments.length - imageCount;
  if (documentCount > input.policy.document.maxDocumentCount) {
    return failure("document_count_exceeded", `A maximum of ${input.policy.document.maxDocumentCount} documents can be sent at once.`);
  }

  const attachments: InputAttachment[] = [];
  let totalImageBytes = 0;
  for (const attachment of input.attachments) {
    if (input.signal?.aborted) return cancelledFailure();
    if (attachment.type === "image") {
      const processed = await processImageInput({
        image: attachment,
        sourceAccess: input.sourceAccess,
        policy: input.policy.image,
        currentTotalBytes: totalImageBytes,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (processed.status === "failed") return processed;
      totalImageBytes = processed.totalBytes;
      attachments.push(processed.image);
    } else {
      const processed = await processDocumentInput({
        document: attachment,
        sourceAccess: input.sourceAccess,
        policy: input.policy.document,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (processed.status === "failed") return processed;
      attachments.push(processed.document);
    }
  }
  return { status: "accepted", attachments };
}

function duplicateAttachmentId(attachments: readonly RawInputAttachment[]): string | undefined {
  const identities = new Set<string>();
  for (const attachment of attachments) {
    if (identities.has(attachment.draftAttachmentId)) return attachment.draftAttachmentId;
    identities.add(attachment.draftAttachmentId);
  }
  return undefined;
}

function invalidAttachmentId(attachments: readonly RawInputAttachment[]): string | undefined {
  return attachments.find((attachment) => attachment.draftAttachmentId.trim().length === 0)
    ?.draftAttachmentId;
}

function cancelledFailure() {
  return failure("input_cancelled", "Input processing was cancelled.");
}

function failure(code: InputFailure["code"], message: string) {
  return { status: "failed" as const, failure: { code, message } };
}
