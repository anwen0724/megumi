// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildModelInputContext } from '@megumi/context-management';
import { buildModelStepInputContextFromSources } from '@megumi/context-management/model-step-input-context';
import * as messageMapper from '@megumi/ai/prompt/message-mapper';
import { AI_PROVIDER_DEFAULTS } from '@megumi/ai/models';
import type { ModelInputContextPart, ModelInputContextSourceRef } from '@megumi/shared/model';
import type { ToolDefinition, ToolResult, ToolCall } from '@megumi/shared/tool';

const builtAt = '2026-05-27T00:00:00.000Z';

function sourceRef(sourceId: string, sourceKind: ModelInputContextSourceRef['sourceKind']): ModelInputContextSourceRef {
  return {
    sourceId,
    sourceKind,
  };
}

function instructionPart(
  overrides: Partial<Extract<ModelInputContextPart, { kind: 'instruction' }>>,
): ModelInputContextPart {
  return {
    partId: 'part:instruction:1',
    kind: 'instruction',
    instructionKind: 'system',
    text: 'System instruction from input context.',
    sourceRefs: [sourceRef('system:1', 'system_instruction')],
    priority: 100,
    budgetStatus: 'included_full',
    ...overrides,
  };
}

function runtimeConstraintPart(
  overrides: Partial<Extract<ModelInputContextPart, { kind: 'runtime_constraint' }>>,
): ModelInputContextPart {
  return {
    partId: 'part:runtime:1',
    kind: 'runtime_constraint',
    constraintKind: 'permission_mode',
    text: 'Permission mode is plan.',
    sourceRefs: [sourceRef('permission-mode:1', 'permission_mode')],
    priority: 80,
    budgetStatus: 'included_full',
    ...overrides,
  };
}

function currentTurnPart(
  overrides: Partial<Extract<ModelInputContextPart, { kind: 'current_turn' }>> = {},
): ModelInputContextPart {
  return {
    partId: 'part:current-turn:1',
    kind: 'current_turn',
    role: 'user',
    text: 'Input context user request.',
    sourceRefs: [sourceRef('message:input-context', 'current_user_message')],
    priority: 90,
    budgetStatus: 'included_full',
    ...overrides,
  };
}

function sessionPart(
  overrides: Partial<Extract<ModelInputContextPart, { kind: 'session' }>> = {},
): ModelInputContextPart {
  return {
    partId: 'part:session:1',
    kind: 'session',
    sessionKind: 'session_history',
    text: 'Earlier session context.',
    sourceRefs: [sourceRef('session-context:1', 'session_context')],
    priority: 60,
    budgetStatus: 'included_full',
    budgetClass: 'contextual',
    ...overrides,
  };
}

function toolContinuationPart(
  overrides: Partial<Extract<ModelInputContextPart, { kind: 'tool_continuation' }>>,
): ModelInputContextPart {
  return {
    partId: 'part:tool-continuation:1',
    kind: 'tool_continuation',
    text: 'Tool continuation text.',
    sourceRefs: [sourceRef('tool-continuation:1', 'tool_call')],
    priority: 80,
    budgetStatus: 'included_full',
    budgetClass: 'continuation',
    ...overrides,
  };
}

describe('OpenAI-compatible message mapper', () => {
  it('maps model step tool definitions to OpenAI-compatible request tools', () => {
    const readFileTool: ToolDefinition = {
      name: 'read_file',
      description: 'Read a file from the current workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      availability: { status: 'available' },
    };

    const inputContext = buildModelInputContext({
      contextId: 'model-input-context:tool-definitions',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'initial_model_step',
      builtAt,
      parts: [
        currentTurnPart({
          text: 'Read package.json.',
        }),
      ],
    });

    expect(messageMapper.mapModelStepToOpenAICompatibleRequest({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      inputContext,
      toolDefinitions: [readFileTool],
      createdAt: '2026-05-17T00:00:00.000Z',
    })).toMatchObject({
      model: 'gpt-5.5',
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file from the current workspace.',
            parameters: readFileTool.inputSchema,
          },
        },
      ],
      tool_choice: 'auto',
    });
  });

  it('preserves provider-native tool replay for continuation requests with input context', () => {
    const toolUse: ToolCall = {
      toolCallId: 'tool-use-1',
      runId: 'run-1',
      modelStepId: 'model-step-1',
      providerToolCallId: 'provider-tool-use-1',
      toolName: 'read_file',
      input: { path: 'package.json' },
      inputPreview: {
        summary: 'read_file package.json',
        targets: [],
        redactionState: 'none',
      },
      status: 'created',
      createdAt: '2026-05-17T00:00:01.000Z',
    };
    const toolResult: ToolResult = {
      toolResultId: 'tool-result-1',
      toolCallId: 'tool-use-1',
      runId: 'run-1',
      kind: 'success',
      textContent: 'File contents',
      redactionState: 'none',
      createdAt: '2026-05-17T00:00:02.000Z',
    };
    const inputContext = buildModelStepInputContextFromSources({
      contextId: 'model-input-context:tool-continuation',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-2',
      buildReason: 'tool_continuation',
      builtAt: '2026-05-17T00:00:03.000Z',
      currentMessage: {
        messageId: 'message-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'Read package.json',
        status: 'completed',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      toolCalls: [toolUse],
      toolResults: [toolResult],
    });

    const messages = messageMapper.mapModelStepToOpenAICompatibleMessages({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-2',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      inputContext,
      toolDefinitions: [],
      createdAt: '2026-05-17T00:00:03.000Z',
    });

    expect(messages).toEqual([
      {
        role: 'user',
        content: 'Read package.json',
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'provider-tool-use-1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path":"package.json"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'provider-tool-use-1',
        content: 'File contents',
      },
    ]);
    expect(JSON.stringify(messages)).not.toContain('Tool result tool-result-1 for tool-use-1');
  });

  it('uses ModelStepRuntimeRequest.inputContext as the model-step prompt source', () => {
    const inputContext = buildModelInputContext({
      contextId: 'model-input-context:1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'initial_model_step',
      builtAt,
      parts: [
        instructionPart({
          partId: 'part:instruction:1',
          text: 'System instruction from input context.',
        }),
        runtimeConstraintPart({
          partId: 'part:runtime:1',
          text: 'Permission mode is plan.',
        }),
        currentTurnPart({
          partId: 'part:current-turn:1',
          text: 'Use the new context path.',
          sourceRefs: [sourceRef('message:1', 'current_user_message')],
        }),
      ],
    });

    const messages = messageMapper.mapModelStepToOpenAICompatibleMessages({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      inputContext,
      toolDefinitions: [],
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    expect(messages).toEqual([
      {
        role: 'system',
        content: 'System instruction from input context.',
      },
      {
        role: 'system',
        content: 'Permission mode is plan.',
      },
      {
        role: 'user',
        content: 'Use the new context path.',
      },
    ]);
  });

  it('keeps tool definitions outside ModelInputContext while building provider tools', () => {
    const readFileTool: ToolDefinition = {
      name: 'read_file',
      description: 'Read a file from the current project.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      availability: { status: 'available' },
    };

    const inputContext = buildModelInputContext({
      contextId: 'model-input-context:2',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'initial_model_step',
      builtAt,
      parts: [
        currentTurnPart({
          text: 'Read package.json.',
        }),
      ],
    });

    const requestBody = messageMapper.mapModelStepToOpenAICompatibleRequest({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      inputContext,
      toolDefinitions: [readFileTool],
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    expect(requestBody.messages).toEqual([
      {
        role: 'user',
        content: 'Read package.json.',
      },
    ]);
    expect(requestBody.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file from the current project.',
          parameters: readFileTool.inputSchema,
        },
      },
    ]);
    expect(JSON.stringify(requestBody.messages)).not.toContain('read_file');
  });

  it('materializes request body with trace without leaking trace-only metadata to provider payload', () => {
    const readFileTool: ToolDefinition = {
      name: 'read_file',
      description: 'Read a file from the current project.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      availability: { status: 'available' },
    };
    const inputContext = buildModelInputContext({
      contextId: 'model-input-context:materialized-trace',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'initial_model_step',
      builtAt,
      parts: [
        instructionPart({
          partId: 'part:instruction:system',
          text: 'System instruction.',
          sourceRefs: [{
            sourceId: 'source:system',
            sourceKind: 'system_instruction',
            sourceUri: 'system://default',
            metadata: {
              traceOnlySecret: 'TRACE_ONLY_METADATA_SHOULD_NOT_APPEAR',
            },
          }],
          budgetClass: 'required',
        }),
        {
          ...instructionPart({
            partId: 'part:instruction:project',
            instructionKind: 'project',
            text: 'Project instruction.',
            sourceRefs: [sourceRef('source:project', 'project_instruction')],
            budgetClass: 'high_priority',
          }),
          required: true,
          truncationHint: {
            originalTokenEstimate: 100,
            retainedTokenEstimate: 40,
            reason: 'project_instruction_hard_cap_exceeded',
          },
        },
        currentTurnPart({
          partId: 'part:current-turn:materialized-trace',
          text: 'Read package.json.',
          sourceRefs: [sourceRef('source:current-turn', 'current_user_message')],
          budgetClass: 'required',
        }),
      ],
      excludedSources: [{
        sourceRef: {
          sourceId: 'source:old-session',
          sourceKind: 'session_context',
          sourceUri: 'session-context://old',
        },
        reason: 'outside_recent_window',
        budgetClass: 'contextual',
      }],
      budgetPolicy: {
        modelContextWindow: 1,
        reservedOutputTokens: 0,
        keepRecentTokens: 0,
      },
    });

    const materialized = messageMapper.materializeModelStepOpenAICompatibleRequest({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      inputContext,
      toolDefinitions: [readFileTool],
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    expect(materialized.body).toEqual({
      model: 'gpt-5.5',
      messages: [
        {
          role: 'system',
          content: 'System instruction.',
        },
        {
          role: 'system',
          content: 'Project instruction.',
        },
        {
          role: 'user',
          content: 'Read package.json.',
        },
      ],
      stream: true,
      stream_options: {
        include_usage: true,
      },
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file from the current project.',
            parameters: readFileTool.inputSchema,
          },
        },
      ],
      tool_choice: 'auto',
    });
    expect(materialized.trace).toEqual({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      contextId: 'model-input-context:materialized-trace',
      buildReason: 'initial_model_step',
      messageRoles: ['system', 'system', 'user'],
      partIds: [
        'part:instruction:system',
        'part:instruction:project',
        'part:current-turn:materialized-trace',
      ],
      selectedSourceIds: [
        'source:system',
        'source:project',
        'source:current-turn',
      ],
      excludedSourceIds: ['source:old-session'],
      truncatedPartIds: ['part:instruction:project'],
      budgetWarningReasons: ['required_context_over_budget'],
      toolDefinitionCount: 1,
    });
    expect(JSON.stringify(materialized.body)).not.toContain('TRACE_ONLY_METADATA_SHOULD_NOT_APPEAR');
    expect(JSON.stringify(materialized.body)).not.toContain('source:old-session');
  });

  it('allows complete tool continuation as the required input subject', () => {
    const inputContext = buildModelInputContext({
      contextId: 'model-input-context:tool-subject',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-2',
      buildReason: 'tool_continuation',
      builtAt,
      parts: [
        instructionPart({
          partId: 'part:instruction:tool-subject',
          text: 'Continue with the tool result.',
        }),
        toolContinuationPart({
          partId: 'part:tool-call:subject',
          text: 'Tool call requested read_file.',
          toolCallId: 'tool-call-1',
          providerToolCallId: 'provider-tool-call-1',
          modelStepId: 'model-step-1',
          toolName: 'read_file',
          toolInput: { path: 'package.json' },
          sourceRefs: [sourceRef('tool-call:subject', 'tool_call')],
        }),
        toolContinuationPart({
          partId: 'part:tool-result:subject',
          text: 'Tool returned package metadata.',
          toolCallId: 'tool-call-1',
          toolResultId: 'tool-result-1',
          toolResultContent: 'Tool returned package metadata.',
          sourceRefs: [sourceRef('tool-result:subject', 'tool_result')],
        }),
      ],
    });

    const materialized = messageMapper.materializeModelStepOpenAICompatibleRequest({
      requestId: 'request-tool-subject',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-2',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      inputContext,
      toolDefinitions: [],
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    expect(materialized.body.messages).toEqual([
      {
        role: 'system',
        content: 'Continue with the tool result.',
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'provider-tool-call-1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path":"package.json"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'provider-tool-call-1',
        content: 'Tool returned package metadata.',
      },
    ]);
    expect(materialized.trace.messageRoles).toEqual(['system', 'assistant', 'tool']);
  });

  it('throws a typed materialization error when the model target is missing at runtime', () => {
    const inputContext = buildModelInputContext({
      contextId: 'model-input-context:missing-model-target',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'initial_model_step',
      builtAt,
      parts: [
        currentTurnPart({
          partId: 'part:current-turn:missing-model-target',
          text: 'Read package.json.',
        }),
      ],
    });

    try {
      messageMapper.materializeModelStepOpenAICompatibleRequest({
        requestId: 'request-missing-model-target',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        providerId: 'openai',
        modelId: undefined as never,
        inputContext,
        toolDefinitions: [],
        createdAt: '2026-05-17T00:00:00.000Z',
      });
      throw new Error('Expected materialization to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(messageMapper.OpenAICompatibleRequestMaterializationError);
      expect(error).toMatchObject({
        code: 'model_target_missing',
        details: {
          requestId: 'request-missing-model-target',
          modelId: '',
          contextId: 'model-input-context:missing-model-target',
          buildReason: 'initial_model_step',
        },
      });
    }
  });

  it('throws a typed materialization error when the required input subject is missing', () => {
    const inputContext = buildModelInputContext({
      contextId: 'model-input-context:missing-subject',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'initial_model_step',
      builtAt,
      parts: [
        sessionPart({
          partId: 'part:session:missing-subject',
          text: 'Only prior session context is available.',
        }),
      ],
    });

    expect(() => messageMapper.materializeModelStepOpenAICompatibleRequest({
      requestId: 'request-missing-subject',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      inputContext,
      toolDefinitions: [],
      createdAt: '2026-05-17T00:00:00.000Z',
    })).toThrow(messageMapper.OpenAICompatibleRequestMaterializationError);

    try {
      messageMapper.materializeModelStepOpenAICompatibleRequest({
        requestId: 'request-missing-subject',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        providerId: 'openai',
        modelId: 'gpt-5.5',
        inputContext,
        toolDefinitions: [],
        createdAt: '2026-05-17T00:00:00.000Z',
      });
      throw new Error('Expected materialization to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(messageMapper.OpenAICompatibleRequestMaterializationError);
      expect(error).toMatchObject({
        code: 'model_input_subject_missing',
        details: {
          requestId: 'request-missing-subject',
          contextId: 'model-input-context:missing-subject',
          buildReason: 'initial_model_step',
        },
      });
    }
  });

  it('exposes phase 1 provider defaults', () => {
    expect(AI_PROVIDER_DEFAULTS).toEqual({
      deepseek: {
        baseUrl: 'https://api.deepseek.com',
        defaultModelId: 'deepseek-v4-flash',
      },
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        defaultModelId: 'gpt-5.5',
      },
      anthropic: {
        defaultModelId: 'claude-sonnet-4-6',
      },
    });
  });
});

