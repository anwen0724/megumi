/*
 * Owns the single processing path from one raw user submission to UserInput.
 */
import type { Api, Model } from "@megumi/ai";
import type { SkillSelection } from "@megumi/skills";
import { processDocumentInput, type DocumentInput } from "./document-input";
import { processImageInput, type ImageInput } from "./image-input";
import { DEFAULT_INPUT_POLICY, type InputPolicy } from "./input-policy";
import type { InputSourceAccess, RawDocumentSource, RawImageSource } from "./input-source";

export interface RawImageInput {
  readonly draftAttachmentId: string;
  readonly type: "image";
  readonly name?: string;
  readonly declaredMimeType?: string;
  readonly source: RawImageSource;
}

export interface RawDocumentInput {
  readonly draftAttachmentId: string;
  readonly type: "file";
  readonly name?: string;
  readonly declaredMimeType?: string;
  readonly source: RawDocumentSource;
}

export type RawInputAttachment = RawImageInput | RawDocumentInput;

export interface RawUserInput {
  readonly text: string;
  readonly attachments?: readonly RawInputAttachment[];
}

export type InputAttachment = ImageInput | DocumentInput;

export interface UserInput {
  readonly text: string;
  readonly attachments: readonly InputAttachment[];
}

export interface InputContext {
  readonly workspaceId: string;
  readonly sessionId?: string;
  readonly model?: Model<Api>;
  readonly selectedSkill?: SkillSelection;
}

export interface ProcessInputRequest {
  readonly input: RawUserInput;
  readonly context: InputContext;
}

export interface InputOperationOptions {
  readonly signal?: AbortSignal;
}

export type ProcessInputResult<TCommandResult> =
  | {
      readonly status: "accepted";
      readonly input: UserInput;
      readonly requestedSkill?: SkillSelection;
    }
  | { readonly status: "command_result"; readonly result: TCommandResult }
  | { readonly status: "failed"; readonly failure: InputFailure };

export interface InputProcessor<TCommandResult> {
  process(
    request: ProcessInputRequest,
    options?: InputOperationOptions,
  ): Promise<ProcessInputResult<TCommandResult>>;
}

export type InputCommandHandlingResult<TCommandResult> =
  | { readonly status: "unhandled" }
  | {
      readonly status: "accepted";
      readonly input: UserInput;
      readonly requestedSkill?: SkillSelection;
    }
  | { readonly status: "command_result"; readonly result: TCommandResult };

export interface InputCommandHandler<TCommandResult> {
  handle(
    input: UserInput,
    context: InputContext,
    options?: InputOperationOptions,
  ): Promise<InputCommandHandlingResult<TCommandResult>>;
}

export interface InputFailure {
  readonly code:
    | "input_processing_failed"
    | "input_cancelled"
    | "input_empty"
    | "attachment_identity_conflict"
    | "image_count_exceeded"
    | "image_too_large"
    | "image_total_size_exceeded"
    | "image_format_unsupported"
    | "image_mime_mismatch"
    | "image_read_failed"
    | "document_count_exceeded"
    | "document_too_large"
    | "document_format_unsupported"
    | "document_mime_mismatch"
    | "document_reference_unavailable";
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function createInputProcessor<TCommandResult>(options: {
  readonly sourceAccess: InputSourceAccess;
  readonly commandHandler?: InputCommandHandler<TCommandResult>;
  readonly policy?: InputPolicy;
}): InputProcessor<TCommandResult> {
  const policy = options.policy ?? DEFAULT_INPUT_POLICY;
  return {
    async process(request, operationOptions = {}) {
      const signal = operationOptions.signal;
      if (signal?.aborted) return cancelledFailure();
      try {
        const text = normalizeInputText(request.input.text);
        const rawAttachments = request.input.attachments ?? [];
        const invalidId = invalidAttachmentId(rawAttachments);
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
        const duplicateId = duplicateAttachmentId(rawAttachments);
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
        const imageCount = rawAttachments.filter((attachment) => attachment.type === "image").length;
        if (imageCount > policy.image.maxImageCount) {
          return failure("image_count_exceeded", `A maximum of ${policy.image.maxImageCount} images can be sent at once.`);
        }
        const documentCount = rawAttachments.length - imageCount;
        if (documentCount > policy.document.maxDocumentCount) {
          return failure("document_count_exceeded", `A maximum of ${policy.document.maxDocumentCount} documents can be sent at once.`);
        }

        const attachments: InputAttachment[] = [];
        let totalImageBytes = 0;
        for (const attachment of rawAttachments) {
          if (signal?.aborted) return cancelledFailure();
          if (attachment.type === "image") {
            const processed = await processImageInput({
              image: attachment,
              sourceAccess: options.sourceAccess,
              policy: policy.image,
              currentTotalBytes: totalImageBytes,
              ...(signal ? { signal } : {}),
            });
            if (processed.status === "failed") return processed;
            totalImageBytes = processed.totalBytes;
            attachments.push(processed.image);
          } else {
            const processed = await processDocumentInput({
              document: attachment,
              sourceAccess: options.sourceAccess,
              policy: policy.document,
              ...(signal ? { signal } : {}),
            });
            if (processed.status === "failed") return processed;
            attachments.push(processed.document);
          }
        }

        if (!text && attachments.length === 0) {
          return failure("input_empty", "Enter a message or select a file.");
        }

        const input: UserInput = { text, attachments };
        if (options.commandHandler) {
          const handled = await options.commandHandler.handle(
            input,
            request.context,
            signal ? { signal } : undefined,
          );
          if (signal?.aborted) return cancelledFailure();
          if (handled.status === "accepted") {
            return {
              ...handled,
              ...(handled.requestedSkill ?? request.context.selectedSkill
                ? { requestedSkill: handled.requestedSkill ?? request.context.selectedSkill }
                : {}),
            };
          }
          if (handled.status === "command_result") return handled;
        }
        return {
          status: "accepted",
          input,
          ...(request.context.selectedSkill ? { requestedSkill: request.context.selectedSkill } : {}),
        };
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) return cancelledFailure();
        return failure(
          "input_processing_failed",
          error instanceof Error ? error.message : "Input processing failed.",
        );
      }
    },
  };
}

function normalizeInputText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function cancelledFailure() {
  return failure("input_cancelled", "Input processing was cancelled.");
}

function failure(code: InputFailure["code"], message: string) {
  return { status: "failed" as const, failure: { code, message } };
}
