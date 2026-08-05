/*
 * Owns the single processing path from one raw user submission to UserInput:
 * text normalization, attachment coordination, input interpretation and the
 * final displayContent/modelContent/skillSelection formation.
 */

import type { Api, Model, TextContent } from "@megumi/ai";
import type {
  ResolveSkillSelectionRequest,
  ResolveSkillSelectionResult,
  SelectedSkillContent,
  SkillSelection,
} from "@megumi/skills";
import { processInputAttachments, type InputAttachment } from "./attachment-input";
import { createInputInterpreterPipeline, InputInterpretationError, type InputInterpreter } from "./input-interpreter";
import { DEFAULT_INPUT_POLICY, InputPolicyConfigurationError, validateInputPolicy, type InputPolicy } from "./input-policy";
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
  readonly skillSelection?: SkillSelection;
}

export type { InputAttachment };

export interface UserInput {
  readonly displayContent: readonly TextContent[];
  readonly modelContent: readonly TextContent[];
  readonly attachments: readonly InputAttachment[];
  readonly skillSelection?: SkillSelection;
}

export interface InputContext {
  readonly workspaceId: string;
  readonly sessionId?: string;
  readonly model?: Model<Api>;
}

export interface ProcessInputRequest {
  readonly input: RawUserInput;
  readonly context: InputContext;
}

export interface InputOperationOptions {
  readonly signal?: AbortSignal;
}

export type ProcessInputResult<TCompletedResult> =
  | {
      readonly status: "accepted";
      readonly input: UserInput;
    }
  | {
      readonly status: "completed";
      readonly result: TCompletedResult;
    }
  | {
      readonly status: "failed";
      readonly failure: InputFailure;
    };

export interface InputProcessor<TCompletedResult> {
  process(
    request: ProcessInputRequest,
    options?: InputOperationOptions,
  ): Promise<ProcessInputResult<TCompletedResult>>;
}

/** Narrow Skills seam: resolves one explicit user Skill selection for this input. */
export interface SkillSelectionResolver {
  resolveSelection(
    request: ResolveSkillSelectionRequest,
    options?: InputOperationOptions,
  ): Promise<ResolveSkillSelectionResult>;
}

export interface InputFailure {
  readonly code:
    | "input_processing_failed"
    | "input_cancelled"
    | "input_empty"
    | "text_length_exceeded"
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
    | "document_reference_unavailable"
    | "input_interpretation_failed"
    | "skill_selection_failed";
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function createInputProcessor<TCompletedResult>(options: {
  readonly sourceAccess: InputSourceAccess;
  readonly interpreters?: readonly InputInterpreter<TCompletedResult>[];
  readonly skillSelectionResolver?: SkillSelectionResolver;
  readonly policy?: InputPolicy;
}): InputProcessor<TCompletedResult> {
  const policy = options.policy ?? DEFAULT_INPUT_POLICY;
  const problems = validateInputPolicy(policy);
  if (problems.length > 0) {
    throw new InputPolicyConfigurationError(problems);
  }
  const pipeline = createInputInterpreterPipeline(options.interpreters ?? []);
  return {
    async process(request, operationOptions = {}) {
      const signal = operationOptions.signal;
      if (signal?.aborted) return cancelledFailure();
      try {
        const text = normalizeInputText(request.input.text);
        if (codePointLength(text) > policy.maxTextCharacters) {
          return failure(
            "text_length_exceeded",
            `Text exceeds the ${policy.maxTextCharacters} character limit.`,
          );
        }
        const attachmentResult = await processInputAttachments({
          attachments: request.input.attachments ?? [],
          sourceAccess: options.sourceAccess,
          policy,
          ...(signal ? { signal } : {}),
        });
        if (attachmentResult.status === "failed") return attachmentResult;
        const attachments = attachmentResult.attachments;
        if (!text && attachments.length === 0) {
          return failure("input_empty", "Enter a message or select a file.");
        }

        const textBlocks = text ? [textBlock(text)] : [];
        let input: UserInput = {
          displayContent: textBlocks,
          modelContent: [...textBlocks],
          attachments,
          ...(request.input.skillSelection ? { skillSelection: request.input.skillSelection } : {}),
        };
        const interpretation = await pipeline.run(input, request.context, signal ? { signal } : undefined);
        if (signal?.aborted) return cancelledFailure();
        if (interpretation.status === "completed") {
          return { status: "completed", result: interpretation.result };
        }
        if (interpretation.status === "accepted") {
          input = interpretation.input;
        }

        if (input.skillSelection) {
          const expanded = await expandSkillSelection({
            skillSelection: input.skillSelection,
            workspaceId: request.context.workspaceId,
            resolver: options.skillSelectionResolver,
            input,
            options: operationOptions,
          });
          if (expanded.status === "failed") return expanded;
          input = expanded.input;
        }
        return { status: "accepted", input };
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) return cancelledFailure();
        if (error instanceof InputInterpretationError) {
          return { status: "failed", failure: error.failure };
        }
        return failure(
          "input_processing_failed",
          error instanceof Error ? error.message : "Input processing failed.",
        );
      }
    },
  };
}

async function expandSkillSelection(input: {
  readonly skillSelection: SkillSelection;
  readonly workspaceId: string;
  readonly resolver: SkillSelectionResolver | undefined;
  readonly input: UserInput;
  readonly options: InputOperationOptions;
}): Promise<{ status: "accepted"; input: UserInput } | { status: "failed"; failure: InputFailure }> {
  const resolver = input.resolver;
  if (!resolver) {
    return {
      status: "failed",
      failure: {
        code: "skill_selection_failed",
        message: "Skill resolution is not configured for this input.",
        details: { skillPath: input.skillSelection.skillPath },
      },
    };
  }
  const resolved = await resolver.resolveSelection(
    {
      skillSelection: input.skillSelection,
      workspaceId: input.workspaceId,
    },
    input.options,
  );
  if (resolved.status === "failed") {
    return {
      status: "failed",
      failure: {
        code: "skill_selection_failed",
        message: `Selected Skill could not be resolved: ${resolved.failure.code}`,
        details: { skillPath: input.skillSelection.skillPath, reason: resolved.failure.code },
      },
    };
  }
  const block = skillBlock(resolved.content);
  return {
    status: "accepted",
    input: {
      ...input.input,
      modelContent: [{ type: "text", text: block }, ...input.input.modelContent],
    },
  };
}

function skillBlock(content: SelectedSkillContent): string {
  return [
    `<skill name="${escapeXmlAttribute(content.name)}" location="${escapeXmlAttribute(content.skillPath)}">`,
    `References are relative to ${escapeXmlAttribute(content.packagePath)}.`,
    "",
    content.content,
    "</skill>",
    "",
  ].join("\n");
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function textBlock(text: string): TextContent {
  return { type: "text", text };
}

function normalizeInputText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function codePointLength(value: string): number {
  return [...value].length;
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

export type { RawImageSource, RawDocumentSource } from "./input-source";
