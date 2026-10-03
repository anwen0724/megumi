/* Interprets user text, explicit skills and attachments for Coding requests. */
import type { SelectedSkillContent, SkillSelection } from '../../skill-operations';
import type { ResolveSkillSelectionRequest, ResolveSkillSelectionResult } from '../../skill-operations';
import type { Api, Model, Models, TextContent } from '@megumi/ai';
import type { InputAttachment, InputSourceAccess, RawDocumentSource, RawImageSource } from './read-attachments';
import { processInputAttachments } from './read-attachments';
type ModelClient = Pick<Models, 'completeSimple' | 'streamSimple'>;

export interface RawImageInput {
  readonly draftAttachmentId: string;
  readonly type: 'image';
  readonly name?: string;
  readonly declaredMimeType?: string;
  readonly source: RawImageSource;
}

export interface RawDocumentInput {
  readonly draftAttachmentId: string;
  readonly type: 'file';
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
  readonly client?: ModelClient;
  readonly compactionThresholdRatio?: number;
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
      readonly status: 'accepted';
      readonly input: UserInput;
    }
  | {
      readonly status: 'completed';
      readonly result: TCompletedResult;
    }
  | {
      readonly status: 'failed';
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
    | 'input_processing_failed'
    | 'input_cancelled'
    | 'input_empty'
    | 'text_length_exceeded'
    | 'attachment_identity_conflict'
    | 'image_count_exceeded'
    | 'image_too_large'
    | 'image_total_size_exceeded'
    | 'image_format_unsupported'
    | 'image_mime_mismatch'
    | 'image_read_failed'
    | 'document_count_exceeded'
    | 'document_too_large'
    | 'document_format_unsupported'
    | 'document_mime_mismatch'
    | 'document_reference_unavailable'
    | 'input_interpretation_failed'
    | 'skill_selection_failed';
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
            'text_length_exceeded',
            `Text exceeds the ${policy.maxTextCharacters} character limit.`,
          );
        }
        const attachmentResult = await processInputAttachments({
          attachments: request.input.attachments ?? [],
          sourceAccess: options.sourceAccess,
          policy,
          ...(signal ? { signal } : {}),
        });
        if (attachmentResult.status === 'failed') return attachmentResult;
        const attachments = attachmentResult.attachments;
        if (!text && attachments.length === 0) {
          return failure('input_empty', 'Enter a message or select a file.');
        }

        const textBlocks = text ? [textBlock(text)] : [];
        let input: UserInput = {
          displayContent: textBlocks,
          modelContent: [...textBlocks],
          attachments,
          ...(request.input.skillSelection ? { skillSelection: request.input.skillSelection } : {}),
        };
        const interpretation = await pipeline.run(
          input,
          request.context,
          signal ? { signal } : undefined,
        );
        if (signal?.aborted) return cancelledFailure();
        if (interpretation.status === 'completed') {
          return { status: 'completed', result: interpretation.result };
        }
        if (interpretation.status === 'accepted') {
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
          if (expanded.status === 'failed') return expanded;
          input = expanded.input;
        }
        return { status: 'accepted', input };
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) return cancelledFailure();
        if (error instanceof InputInterpretationError) {
          return { status: 'failed', failure: error.failure };
        }
        return failure(
          'input_processing_failed',
          error instanceof Error ? error.message : 'Input processing failed.',
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
}): Promise<
  { status: 'accepted'; input: UserInput } | { status: 'failed'; failure: InputFailure }
> {
  const resolver = input.resolver;
  if (!resolver) {
    return {
      status: 'failed',
      failure: {
        code: 'skill_selection_failed',
        message: 'Skill resolution is not configured for this input.',
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
  if (resolved.status === 'failed') {
    return {
      status: 'failed',
      failure: {
        code: 'skill_selection_failed',
        message: `Selected Skill could not be resolved: ${resolved.failure.code}`,
        details: { skillPath: input.skillSelection.skillPath, reason: resolved.failure.code },
      },
    };
  }
  const block = skillBlock(resolved.content);
  return {
    status: 'accepted',
    input: {
      ...input.input,
      modelContent: [{ type: 'text', text: block }, ...input.input.modelContent],
    },
  };
}

function skillBlock(content: SelectedSkillContent): string {
  return [
    `<skill name="${escapeXmlAttribute(content.name)}" location="${escapeXmlAttribute(content.skillPath)}">`,
    `References are relative to ${escapeXmlAttribute(content.packagePath)}.`,
    '',
    content.content,
    '</skill>',
    '',
  ].join('\n');
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function textBlock(text: string): TextContent {
  return { type: 'text', text };
}

function normalizeInputText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function codePointLength(value: string): number {
  return [...value].length;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function cancelledFailure() {
  return failure('input_cancelled', 'Input processing was cancelled.');
}

function failure(code: InputFailure['code'], message: string) {
  return { status: 'failed' as const, failure: { code, message } };
}

export type { RawDocumentSource, RawImageSource } from './read-attachments';

export type InputInterpretation<TResult> =
  | { readonly status: "unhandled" }
  | { readonly status: "accepted"; readonly input: UserInput }
  | { readonly status: "completed"; readonly result: TResult };

export interface InputInterpreter<TResult> {
  interpret(
    input: UserInput,
    context: InputContext,
    options?: InputOperationOptions,
  ): Promise<InputInterpretation<TResult>>;
}

/** Controlled cross-Package failure channel carrying an already classified InputFailure. */
export class InputInterpretationError extends Error {
  constructor(readonly failure: InputFailure) {
    super(failure.message);
    this.name = "InputInterpretationError";
  }
}

export function createInputInterpreterPipeline<TResult>(
  interpreters: readonly InputInterpreter<TResult>[],
): {
  run(
    input: UserInput,
    context: InputContext,
    options?: InputOperationOptions,
  ): Promise<InputInterpretation<TResult>>;
} {
  return {
    async run(input, context, options) {
      for (const interpreter of interpreters) {
        const result = await interpreter.interpret(input, context, options);
        if (result.status === "unhandled") continue;
        return result;
      }
      return { status: "unhandled" };
    },
  };
}

export type SupportedImageMediaType = "image/png" | "image/jpeg" | "image/webp";

export type SupportedDocumentMediaType =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "text/plain"
  | "text/markdown";

export interface ImageInputPolicy {
  readonly allowedMediaTypes: readonly SupportedImageMediaType[];
  readonly maxImageCount: number;
  readonly maxImageBytes: number;
  readonly maxTotalBytes: number;
}

export interface DocumentInputPolicy {
  readonly allowedMediaTypes: readonly SupportedDocumentMediaType[];
  readonly maxDocumentCount: number;
  readonly maxDocumentBytes: number;
}

export interface InputPolicy {
  readonly maxTextCharacters: number;
  readonly image: ImageInputPolicy;
  readonly document: DocumentInputPolicy;
}

export class InputPolicyConfigurationError extends Error {
  constructor(problems: readonly string[]) {
    super(`Input Policy is invalid: ${problems.join(' ')}`);
    this.name = 'InputPolicyConfigurationError';
  }
}

export function validateInputPolicy(policy: InputPolicy): string[] {
  const problems: string[] = [];
  const entries: Array<[string, number]> = [
    ['maxTextCharacters', policy.maxTextCharacters],
    ['image.maxImageCount', policy.image.maxImageCount],
    ['image.maxImageBytes', policy.image.maxImageBytes],
    ['image.maxTotalBytes', policy.image.maxTotalBytes],
    ['document.maxDocumentCount', policy.document.maxDocumentCount],
    ['document.maxDocumentBytes', policy.document.maxDocumentBytes],
  ];
  for (const [label, value] of entries) {
    if (!Number.isInteger(value) || value <= 0) {
      problems.push(`${label} must be a positive integer, got ${String(value)}.`);
    }
  }
  if (policy.image.maxTotalBytes < policy.image.maxImageBytes) {
    problems.push('image.maxTotalBytes must be >= image.maxImageBytes.');
  }
  return problems;
}

export const IMAGE_INPUT_POLICY: ImageInputPolicy = Object.freeze({
  allowedMediaTypes: ["image/png", "image/jpeg", "image/webp"] as const,
  maxImageCount: 5,
  maxImageBytes: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
});

export const DOCUMENT_INPUT_POLICY: DocumentInputPolicy = Object.freeze({
  allowedMediaTypes: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
  ] as const,
  maxDocumentCount: 10,
  maxDocumentBytes: 50 * 1024 * 1024,
});

export const DEFAULT_INPUT_POLICY: InputPolicy = Object.freeze({
  maxTextCharacters: 200_000,
  image: IMAGE_INPUT_POLICY,
  document: DOCUMENT_INPUT_POLICY,
});

export interface InputCapabilities {
  readonly maxTextCharacters: number;
  readonly allowedImageMediaTypes: readonly SupportedImageMediaType[];
  readonly maxImageCount: number;
  readonly maxImageBytes: number;
  readonly maxTotalImageBytes: number;
  readonly allowedDocumentMediaTypes: readonly SupportedDocumentMediaType[];
  readonly maxDocumentCount: number;
  readonly maxDocumentBytes: number;
}

export function inputCapabilities(policy: InputPolicy = DEFAULT_INPUT_POLICY): InputCapabilities {
  return {
    maxTextCharacters: policy.maxTextCharacters,
    allowedImageMediaTypes: [...policy.image.allowedMediaTypes],
    maxImageCount: policy.image.maxImageCount,
    maxImageBytes: policy.image.maxImageBytes,
    maxTotalImageBytes: policy.image.maxTotalBytes,
    allowedDocumentMediaTypes: [...policy.document.allowedMediaTypes],
    maxDocumentCount: policy.document.maxDocumentCount,
    maxDocumentBytes: policy.document.maxDocumentBytes,
  };
}
