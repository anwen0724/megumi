/*
 * Coordinates attachments for one input: identity checks, per-type limits,
 * submission-order dispatch and the all-or-nothing failure rule.
 */

import { processDocumentInput, type DocumentInput } from "./document-input";
import { processImageInput, type ImageInput } from "./image-input";
import type { InputPolicy } from "./input-policy";
import type { InputSourceAccess } from "./input-source";
import type { InputFailure, RawInputAttachment } from "./input";

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
