// Materializes provider-neutral model step input into OpenAI-compatible request bodies.
// This module does not select context sources, read project files, or execute tools.
import type { JsonObject } from '@megumi/shared/primitives';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { ModelInputContextPart, ToolContinuationPart } from '@megumi/shared/model';
import type { ToolDefinition } from '@megumi/shared/tool';
import type {
  OpenAICompatibleChatCompletionRequestBody,
  OpenAICompatibleMessage,
  OpenAICompatibleToolDefinition,
} from '../types';
import { mapModelInputContextToOpenAICompatibleMessages } from './model-input-context-mapper';

export type OpenAICompatibleRequestMaterializationErrorCode =
  | 'model_target_missing'
  | 'model_input_subject_missing';

export interface OpenAICompatibleProviderRequestTrace {
  requestId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  providerId: string;
  modelId: string;
  contextId: string;
  buildReason: string;
  messageRoles: OpenAICompatibleMessage['role'][];
  partIds: string[];
  selectedSourceIds: string[];
  excludedSourceIds: string[];
  truncatedPartIds: string[];
  budgetWarningReasons: string[];
  toolDefinitionCount: number;
}

export interface OpenAICompatibleMaterializedProviderRequest {
  body: OpenAICompatibleChatCompletionRequestBody;
  trace: OpenAICompatibleProviderRequestTrace;
}

export class OpenAICompatibleRequestMaterializationError extends Error {
  constructor(
    readonly code: OpenAICompatibleRequestMaterializationErrorCode,
    message: string,
    readonly details: JsonObject,
  ) {
    super(message);
    this.name = 'OpenAICompatibleRequestMaterializationError';
  }
}

export function materializeModelStepOpenAICompatibleRequest(
  request: ModelStepRuntimeRequest,
): OpenAICompatibleMaterializedProviderRequest {
  assertMaterializableModelStepRequest(request);

  const tools = request.toolDefinitions?.map(mapToolDefinition);
  const body: OpenAICompatibleChatCompletionRequestBody = {
    model: String(request.modelId),
    messages: mapModelStepToOpenAICompatibleMessages(request),
    stream: true,
    stream_options: {
      include_usage: true,
    },
    ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
  };

  return {
    body,
    trace: materializationTraceFor(request, body),
  };
}

export function mapModelStepToOpenAICompatibleRequest(
  request: ModelStepRuntimeRequest,
): OpenAICompatibleChatCompletionRequestBody {
  return materializeModelStepOpenAICompatibleRequest(request).body;
}

export function mapModelStepToOpenAICompatibleMessages(
  request: ModelStepRuntimeRequest,
): OpenAICompatibleMessage[] {
  return mapModelInputContextToOpenAICompatibleMessages(request.inputContext);
}

function assertMaterializableModelStepRequest(request: ModelStepRuntimeRequest): void {
  if (!String(request.modelId).trim()) {
    throw new OpenAICompatibleRequestMaterializationError(
      'model_target_missing',
      'Model target is required before provider request materialization.',
      baseErrorDetails(request),
    );
  }

  if (!hasRequiredInputSubject(request.inputContext.parts)) {
    throw new OpenAICompatibleRequestMaterializationError(
      'model_input_subject_missing',
      'A model step requires current user text or a complete tool continuation pairing.',
      baseErrorDetails(request),
    );
  }
}

function hasRequiredInputSubject(parts: ModelInputContextPart[]): boolean {
  if (parts.some((part) => part.kind === 'current_turn' && part.role === 'user' && part.text.trim().length > 0)) {
    return true;
  }

  return hasCompleteToolContinuationSubject(parts);
}

function hasCompleteToolContinuationSubject(parts: ModelInputContextPart[]): boolean {
  const completeToolCallIds = new Set(
    parts
      .filter((part): part is ToolContinuationPart => part.kind === 'tool_continuation')
      .filter((part) => part.toolCallId && part.toolName && part.toolInput !== undefined)
      .map((part) => String(part.toolCallId)),
  );

  return parts
    .filter((part): part is ToolContinuationPart => part.kind === 'tool_continuation')
    .some((part) => (
      Boolean(part.toolCallId && part.toolResultId && part.toolResultContent !== undefined)
      && completeToolCallIds.has(String(part.toolCallId))
    ));
}

function baseErrorDetails(request: ModelStepRuntimeRequest): JsonObject {
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    runId: String(request.runId),
    stepId: request.stepId,
    providerId: request.providerId,
    modelId: String(request.modelId),
    contextId: request.inputContext.contextId,
    buildReason: request.inputContext.trace.buildReason,
  };
}

function materializationTraceFor(
  request: ModelStepRuntimeRequest,
  body: OpenAICompatibleChatCompletionRequestBody,
): OpenAICompatibleProviderRequestTrace {
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    runId: String(request.runId),
    stepId: request.stepId,
    providerId: request.providerId,
    modelId: String(request.modelId),
    contextId: request.inputContext.contextId,
    buildReason: request.inputContext.trace.buildReason,
    messageRoles: body.messages.map((message) => message.role),
    partIds: request.inputContext.parts.map((part) => part.partId),
    selectedSourceIds: request.inputContext.trace.selectedSources.map((source) => source.sourceId),
    excludedSourceIds: request.inputContext.trace.excludedSources.map((source) => source.sourceRef.sourceId),
    truncatedPartIds: request.inputContext.parts
      .filter((part) => part.budgetStatus === 'included_truncated')
      .map((part) => part.partId),
    budgetWarningReasons: (request.inputContext.trace.budgetWarnings ?? []).map((warning) => warning.reason),
    toolDefinitionCount: request.toolDefinitions?.length ?? 0,
  };
}

function mapToolDefinition(tool: ToolDefinition): OpenAICompatibleToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}
