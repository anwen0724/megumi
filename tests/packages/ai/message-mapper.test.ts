// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildModelInputContext } from '@megumi/context-management';
import { buildModelStepInputContextFromSources } from '@megumi/context-management/model-step-input-context';
import * as messageMapper from '@megumi/ai/prompt/message-mapper';
import { AI_PROVIDER_DEFAULTS } from '@megumi/ai/models';
import type { ModelInputContextPart, ModelInputContextSourceRef } from '@megumi/shared/model-input-context-contracts';
import type { ToolDefinition, ToolResult, ToolCall } from '@megumi/shared/tool-contracts';

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
