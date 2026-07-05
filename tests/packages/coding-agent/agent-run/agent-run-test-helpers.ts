import { vi } from 'vitest';
import type { AgentRun, AgentRunApprovalRequest } from '@megumi/coding-agent/agent-run';
import type { AgentRunRepository } from '@megumi/coding-agent/agent-run/repositories/agent-run-repository';
import type { RegisteredTool, ToolExecutionResult } from '@megumi/coding-agent/tools';

export function createInMemoryAgentRunRepository(): AgentRunRepository {
  const runs = new Map<string, AgentRun>();
  const approvals = new Map<string, AgentRunApprovalRequest>();

  return {
    createRun(run) {
      runs.set(run.run_id, run);
      return run;
    },
    getRun(runId) {
      return runs.get(runId);
    },
    saveRun(run) {
      runs.set(run.run_id, run);
      return run;
    },
    listInterruptedRuns() {
      return [...runs.values()].filter((run) => (
        run.status === 'running'
        || run.status === 'waiting_for_approval'
        || run.status === 'cancelling'
      ));
    },
    createApprovalRequest(request) {
      approvals.set(request.approval_request_id, request);
      return request;
    },
    getApprovalRequest(approvalRequestId) {
      return approvals.get(approvalRequestId);
    },
    saveApprovalRequest(request) {
      approvals.set(request.approval_request_id, request);
      return request;
    },
    listPendingApprovalRequestsByRun(runId) {
      return [...approvals.values()]
        .filter((approval) => approval.run_id === runId && approval.status === 'pending');
    },
  };
}

export function createMessageFlowDependencies(input: {
  repository?: AgentRunRepository;
  modelEvents?: Array<Record<string, unknown>>;
  commandResult?: unknown;
  max_model_calls?: number;
  max_tool_rounds?: number;
} = {}) {
  const repository = input.repository ?? createInMemoryAgentRunRepository();
  const tool = registeredTool('read_file', 'parallel');
  return {
    repository,
    input_service: {
      processUserInput: vi.fn(async (request) => ({
        status: 'ok' as const,
        parsed_user_input: request.user_input.text.startsWith('/')
          ? { type: 'command' as const, text: request.user_input.text, attachments: request.user_input.attachments ?? [] }
          : { type: 'message' as const, text: request.user_input.text, attachments: request.user_input.attachments ?? [] },
      })),
    },
    command_service: {
      handleCommandInput: vi.fn(async () => input.commandResult ?? ({ type: 'not_command' as const, raw_input: '/unknown' })),
    },
    session_service: {
      getSession: vi.fn(() => ({
        status: 'found' as const,
        session: {
          session_id: 'session-1',
          workspace_id: 'workspace-1',
          title: 'Session',
          status: 'active' as const,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      })),
      createSession: vi.fn(() => ({
        status: 'created' as const,
        session: {
          session_id: 'session-1',
          workspace_id: 'workspace-1',
          title: 'Session',
          status: 'active' as const,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      })),
      saveUserMessage: vi.fn(() => ({
        status: 'saved' as const,
        message: {
          message_id: 'message-1',
          session_id: 'session-1',
          role: 'user' as const,
          content_text: 'hello',
          created_at: '2026-01-01T00:00:00.000Z',
          completed_at: '2026-01-01T00:00:00.000Z',
        },
        entry: {
          entry_id: 'entry-message-1',
          session_id: 'session-1',
          entry_type: 'message' as const,
          message_id: 'message-1',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      })),
      saveAssistantMessage: vi.fn(() => ({
        status: 'saved' as const,
        message: {
          message_id: 'assistant-message-1',
          session_id: 'session-1',
          run_id: 'run-1',
          role: 'assistant' as const,
          content_text: 'assistant reply',
          created_at: '2026-01-01T00:00:00.000Z',
          completed_at: '2026-01-01T00:00:00.000Z',
        },
        entry: {
          entry_id: 'entry-assistant-message-1',
          session_id: 'session-1',
          entry_type: 'message' as const,
          message_id: 'assistant-message-1',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      })),
    },
    settings_service: {
      resolveProviderRuntimeConfig: vi.fn(() => ({
        status: 'ok' as const,
        config: {
          provider_id: 'deepseek',
          protocol: 'openai-compatible' as const,
          base_url: 'https://api.deepseek.com',
          model_id: 'deepseek-chat',
          api_key: 'test-key',
        },
      })),
      resolvePermissionSettings: vi.fn(() => ({
        status: 'ok' as const,
        permission_settings: { allow: [], ask: [], deny: [] },
      })),
    },
    context_service: {
      getSessionContext: vi.fn(async () => ({
        status: 'ok' as const,
        session_context: {
          session_id: 'session-1',
          workspace_id: 'workspace-1',
          sources: [],
        },
      })),
      buildPrompt: vi.fn(() => ({
        status: 'ok' as const,
        prompt: {
          prompt_id: 'prompt-1',
          purpose: 'agent_response' as const,
          messages: [{ role: 'user' as const, content: 'hello' }],
          source_refs: [],
        },
      })),
    },
    model_call_service: {
      modelCall: vi.fn(() => ({
        status: 'started' as const,
        model_call_id: 'model-call-1',
        events: asyncEvents(input.modelEvents ?? [
          { type: 'started', model_call_id: 'model-call-1', created_at: '2026-01-01T00:00:00.000Z' },
          { type: 'text_delta', model_call_id: 'model-call-1', delta: 'assistant ', created_at: '2026-01-01T00:00:00.000Z' },
          { type: 'text_delta', model_call_id: 'model-call-1', delta: 'reply', created_at: '2026-01-01T00:00:00.000Z' },
          { type: 'completed', model_call_id: 'model-call-1', content: 'assistant reply', created_at: '2026-01-01T00:00:00.000Z' },
        ]),
      })),
      cancelModelCall: vi.fn(() => ({ status: 'not_found' as const, model_call_id: 'model-call-1' })),
    },
    tool_registry_service: {
      listAvailableTools: vi.fn(() => ({ tools: [tool] })),
    },
    tool_execution_service: {
      executeTool: vi.fn(async (request): Promise<ToolExecutionResult> => ({
        type: 'succeeded',
        toolName: request.toolName,
        rawResult: { outputKind: 'text', content: 'tool ok' },
        normalizedResult: { kind: 'text', content: 'tool ok', isError: false, truncated: false },
        toolExecutionObservation: { summary: 'tool ok' },
      })),
    },
    permission_service: {
      evaluateToolExecution: vi.fn(() => ({
        status: 'ok' as const,
        decision: { type: 'allow' as const, reason: 'allowed', execution_class: 'read_only' as const },
      })),
    },
    workspace_path_policy_service: {
      classifyPath: vi.fn(() => ({
        absolute_path: 'C:/workspace/README.md',
        workspace_path: 'README.md',
        inside_workspace: true,
        protected: false,
        sensitive: false,
      })),
    },
    memory_service: {
      captureCompletedRun: vi.fn(async () => ({ status: 'captured' as const })),
    },
    event_publisher: {
      publish: vi.fn((event) => event),
    },
    ids: {
      run_id: () => 'run-1',
      session_id: () => 'session-1',
      user_message_id: () => 'message-1',
      assistant_message_id: () => 'assistant-message-1',
      approval_request_id: () => 'approval-1',
      event_id: (() => {
        let index = 0;
        return () => `event-${index += 1}`;
      })(),
    },
    clock: {
      now: () => '2026-01-01T00:00:00.000Z',
    },
    limits: {
      max_model_calls: input.max_model_calls ?? 4,
      max_tool_rounds: input.max_tool_rounds ?? 4,
    },
  };
}

export async function collectEvents<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

function registeredTool(name: string, executionMode: 'parallel' | 'serial'): RegisteredTool {
  return {
    identity: { sourceId: 'built-in', namespace: 'built-in', sourceToolName: name },
    registeredToolName: name,
    source: {
      sourceId: 'built-in',
      sourceKind: 'built_in',
      namespace: 'built-in',
      displayName: 'Built in',
      configured: true,
      enabled: true,
      availabilityStatus: 'available',
    },
    status: 'available',
    definition: {
      name,
      description: name,
      inputSchema: { type: 'object' },
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      availability: { status: 'available' },
      executionMode,
    },
  };
}

async function* asyncEvents<T>(events: T[]): AsyncIterable<T> {
  yield* events;
}
