// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildModelInputContext } from '@megumi/memory';
import type { ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import * as messageMapper from '@megumi/ai/prompt/message-mapper';
import { buildSystemPrompt } from '@megumi/ai/prompt/system-prompt';
import { AI_PROVIDER_DEFAULTS } from '@megumi/ai/models';
import type { ModelInputContextPart, ModelInputContextSourceRef } from '@megumi/shared/model-input-context-contracts';
import type { ToolDefinition, ToolResult, ToolUse } from '@megumi/shared/tool-contracts';

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

const request: ChatRuntimeRequest = {
  requestId: 'request-1',
  providerId: 'deepseek',
  modelId: 'deepseek-v4-flash',
  createdAt: '2026-05-11T00:00:00.000Z',
  context: {
    workspaceLabel: 'Megumi Workspace',
    workspacePath: 'C:/all/work/study/megumi',
    sessionTitle: 'Provider runtime',
    permissionMode: 'plan',
  },
  messages: [
    {
      id: 'message-1',
      role: 'user',
      content: '你好',
      createdAt: '2026-05-11T00:00:00.000Z',
    },
    {
      id: 'message-2',
      role: 'assistant',
      content: '你好，我在。',
      createdAt: '2026-05-11T00:00:01.000Z',
    },
  ],
};

describe('system prompt', () => {
  it('builds minimal workspace grounding without crawling files', () => {
    expect(buildSystemPrompt(request.context)).toBe(
      [
        'You are Megumi, a warm and capable desktop AI agent companion.',
        'Current workspace: Megumi Workspace',
        'Workspace path: C:/all/work/study/megumi',
        'Current session: Provider runtime',
        'Permission mode: plan',
        'Use the provided context only as lightweight orientation. Do not claim to have inspected files unless tool results are provided.',
      ].join('\n'),
    );
  });
});

describe('OpenAI-compatible message mapper', () => {
  it('prepends a context system message and maps chat roles', () => {
    expect(messageMapper.mapToOpenAICompatibleMessages(request)).toEqual([
      {
        role: 'system',
        content: buildSystemPrompt(request.context),
      },
      {
        role: 'user',
        content: '你好',
      },
      {
        role: 'assistant',
        content: '你好，我在。',
      },
    ]);
  });

  it('keeps explicit system messages after the generated context prompt', () => {
    const messages = messageMapper.mapToOpenAICompatibleMessages({
      ...request,
      messages: [
        {
          id: 'message-system',
          role: 'system',
          content: 'Answer concisely.',
          createdAt: '2026-05-11T00:00:00.000Z',
        },
      ],
    });

    expect(messages).toEqual([
      {
        role: 'system',
        content: buildSystemPrompt(request.context),
      },
      {
        role: 'system',
        content: 'Answer concisely.',
      },
    ]);
  });

  it('maps session messages for model step requests', () => {
    expect(messageMapper.mapModelStepToOpenAICompatibleMessages({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      messages: [
        {
          messageId: 'message-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Hello',
          status: 'completed',
          createdAt: '2026-05-17T00:00:00.000Z',
        },
      ],
      createdAt: '2026-05-17T00:00:00.000Z',
    })).toEqual([
      {
        role: 'system',
        content: expect.stringContaining('You are Megumi'),
      },
      {
        role: 'user',
        content: 'Hello',
      },
    ]);
  });

  it('adds permission mode runtime instructions to model step system prompts', () => {
    const messages = messageMapper.mapModelStepToOpenAICompatibleMessages({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      messages: [
        {
          messageId: 'message-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Write the implementation plan',
          status: 'completed',
          createdAt: '2026-05-17T00:00:00.000Z',
        },
      ],
      modeSnapshot: {
        permissionMode: 'plan',
        source: 'user',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      modeSnapshotRef: 'mode-snapshot:1',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    expect(messages[0]?.content).toContain('Permission mode: plan');
    expect(messages[0]?.content).toContain('Do not modify files or run side-effecting commands.');
    expect(messages[0]?.content).not.toContain('Task intent:');
    expect(messages[0]?.content).not.toContain('Output expectation:');
  });

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

    expect(messageMapper.mapModelStepToOpenAICompatibleRequest({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      messages: [],
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

  it('appends previous tool results as OpenAI-compatible tool messages', () => {
    const toolResult: ToolResult = {
      toolResultId: 'tool-result-1',
      toolUseId: 'tool-use-1',
      runId: 'run-1',
      kind: 'success',
      textContent: 'File contents',
      redactionState: 'none',
      createdAt: '2026-05-17T00:00:01.000Z',
    };

    expect(messageMapper.mapModelStepToOpenAICompatibleMessages({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      messages: [],
      toolResults: [toolResult],
      createdAt: '2026-05-17T00:00:00.000Z',
    })).toContainEqual({
      role: 'tool',
      tool_call_id: 'tool-use-1',
      content: 'File contents',
    });
  });

  it('orders previous assistant tool calls before matching tool result messages', () => {
    const toolUse: ToolUse = {
      toolUseId: 'tool-use-1',
      runId: 'run-1',
      modelStepId: 'model-step-1',
      providerToolUseId: 'provider-tool-use-1',
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
      toolUseId: 'tool-use-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      kind: 'success',
      textContent: 'File contents',
      redactionState: 'none',
      createdAt: '2026-05-17T00:00:02.000Z',
    };

    const messages = messageMapper.mapModelStepToOpenAICompatibleMessages({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-2',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      messages: [
        {
          messageId: 'message-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Read package.json',
          status: 'completed',
          createdAt: '2026-05-17T00:00:00.000Z',
        },
      ],
      toolUses: [toolUse],
      toolResults: [toolResult],
      createdAt: '2026-05-17T00:00:03.000Z',
    });

    expect(messages.slice(-2)).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tool-use-1',
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
        tool_call_id: 'tool-use-1',
        content: 'File contents',
      },
    ]);
  });

  it('replays model step provider reasoning state on matching assistant tool call messages', () => {
    const toolUse: ToolUse = {
      toolUseId: 'tool-use-1',
      runId: 'run-1',
      modelStepId: 'model-step-1',
      providerToolUseId: 'provider-tool-use-1',
      toolName: 'list_directory',
      input: { path: 'docs' },
      inputPreview: {
        summary: 'list_directory docs',
        targets: [],
        redactionState: 'none',
      },
      status: 'created',
      createdAt: '2026-05-17T00:00:01.000Z',
    };
    const toolResult: ToolResult = {
      toolResultId: 'tool-result-1',
      toolUseId: 'tool-use-1',
      runId: 'run-1',
      kind: 'success',
      textContent: 'directory README.md',
      redactionState: 'none',
      createdAt: '2026-05-17T00:00:02.000Z',
    };

    const messages = messageMapper.mapModelStepToOpenAICompatibleMessages({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-2',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      messages: [],
      toolUses: [toolUse],
      toolResults: [toolResult],
      providerStates: [
        {
          modelStepId: 'model-step-1',
          providerId: 'deepseek',
          modelId: 'deepseek-v4-flash',
          blocks: [
            {
              type: 'reasoning_content',
              text: 'I should inspect the docs directory.',
            },
          ],
        },
      ],
      createdAt: '2026-05-17T00:00:03.000Z',
    });

    expect(messages.slice(-2)).toEqual([
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'I should inspect the docs directory.',
        tool_calls: [
          {
            id: 'tool-use-1',
            type: 'function',
            function: {
              name: 'list_directory',
              arguments: '{"path":"docs"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'tool-use-1',
        content: 'directory README.md',
      },
    ]);
  });

  it('serializes non-text tool result fallback content with result metadata', () => {
    const toolResult: ToolResult = {
      toolResultId: 'tool-result-1',
      toolUseId: 'tool-use-1',
      runId: 'run-1',
      kind: 'policy_denied',
      structuredContent: {
        path: 'C:/all/work/study/megumi/.env',
      },
      denialReason: 'Reading secrets is not allowed.',
      redactionState: 'blocked',
      createdAt: '2026-05-17T00:00:01.000Z',
    };

    const messages = messageMapper.mapModelStepToOpenAICompatibleMessages({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      messages: [],
      toolResults: [toolResult],
      createdAt: '2026-05-17T00:00:00.000Z',
    });
    const toolMessage = messages.find((message) => message.role === 'tool');

    expect(toolMessage?.tool_call_id).toBe('tool-use-1');
    expect(JSON.parse(toolMessage?.content ?? '')).toEqual({
      kind: 'policy_denied',
      structuredContent: {
        path: 'C:/all/work/study/megumi/.env',
      },
      denialReason: 'Reading secrets is not allowed.',
    });
  });

  it('uses permission mode snapshots without legacy task intent or output expectation prompt lines', () => {
    const messages = messageMapper.mapModelStepToOpenAICompatibleMessages({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      messages: [],
      modeSnapshot: {
        permissionMode: 'plan',
        source: 'user',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    expect(messages[0]?.content).toContain('Permission mode: plan');
    expect(messages[0]?.content).not.toContain('Task intent:');
    expect(messages[0]?.content).not.toContain('Output expectation:');
  });

  it('uses ModelStepRuntimeRequest.inputContext as the model-step prompt source when present', () => {
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
      messages: [
        {
          messageId: 'legacy-message-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Legacy message must not appear.',
          status: 'completed',
          createdAt: '2026-05-17T00:00:00.000Z',
        },
      ],
      modeSnapshot: {
        permissionMode: 'default',
        source: 'user',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      runtimeContext: {
        requestId: 'request-1',
        traceId: 'trace-1',
        operationName: 'model-step',
        source: 'core',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const serializedMessages = JSON.stringify(messages);

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
    expect(serializedMessages).not.toContain('Legacy message must not appear.');
    expect(serializedMessages).not.toContain('trace-1');
    expect(serializedMessages).not.toContain('Produce the requested response');
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
      messages: [],
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
