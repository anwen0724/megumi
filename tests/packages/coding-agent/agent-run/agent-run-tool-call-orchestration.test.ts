import { describe, expect, it, vi } from 'vitest';
import type { RegisteredTool, ToolExecutionResult } from '@megumi/coding-agent/tools';
import type { EvaluateToolExecutionResult, PermissionDecision } from '@megumi/coding-agent/permissions';
import {
  orchestrateToolCallGroup,
  type AgentRunToolCallRequest,
} from '@megumi/coding-agent/agent-run/core/tool-call-orchestrator';

describe('Agent Run tool-call orchestration', () => {
  it('validates tools, resolves permission facts, and executes parallel windows concurrently', async () => {
    const order: string[] = [];
    const result = await orchestrateToolCallGroup({
      ...baseInput(),
      tool_calls: [
        toolCall('call-1', 'read_file'),
        toolCall('call-2', 'list_files'),
      ],
      registered_tools_by_name: new Map([
        ['read_file', registeredTool('read_file', 'parallel')],
        ['list_files', registeredTool('list_files', 'parallel')],
      ]),
      permission_service: {
        evaluateToolExecution: vi.fn(() => ({
          ...permissionResult(allowDecision()),
        })),
      },
      tool_execution_service: {
        executeTool: vi.fn(async (request) => {
          order.push(`start:${request.toolName}`);
          await Promise.resolve();
          order.push(`end:${request.toolName}`);
          return succeededToolResult(request.toolName);
        }),
      },
    });

    expect(result.tool_calls.map((call) => [call.tool_call_id, call.call_order])).toEqual([
      ['call-1', 0],
      ['call-2', 1],
    ]);
    expect(result.tool_result_facts.map((toolResult) => toolResult.status)).toEqual(['completed', 'completed']);
    expect(order).toEqual(['start:read_file', 'start:list_files', 'end:read_file', 'end:list_files']);
    expect(result.next_model_prompt_ready).toBe(true);
  });

  it('uses serial execution mode as an execution window barrier', async () => {
    const order: string[] = [];
    await orchestrateToolCallGroup({
      ...baseInput(),
      tool_calls: [
        toolCall('call-1', 'read_file'),
        toolCall('call-2', 'run_command'),
        toolCall('call-3', 'list_files'),
      ],
      registered_tools_by_name: new Map([
        ['read_file', registeredTool('read_file', 'parallel')],
        ['run_command', registeredTool('run_command', 'serial')],
        ['list_files', registeredTool('list_files', 'parallel')],
      ]),
      permission_service: {
        evaluateToolExecution: vi.fn(() => ({
          ...permissionResult(allowDecision()),
        })),
      },
      tool_execution_service: {
        executeTool: vi.fn(async (request) => {
          order.push(request.toolName);
          return succeededToolResult(request.toolName);
        }),
      },
    });

    expect(order).toEqual(['read_file', 'run_command', 'list_files']);
  });

  it('does not execute unknown or denied tools and turns them into run context facts', async () => {
    const executeTool = vi.fn();
    const result = await orchestrateToolCallGroup({
      ...baseInput(),
      tool_calls: [
        toolCall('call-1', 'unknown_tool'),
        toolCall('call-2', 'run_command'),
      ],
      registered_tools_by_name: new Map([
        ['run_command', registeredTool('run_command', 'serial')],
      ]),
      permission_service: {
        evaluateToolExecution: vi.fn(() => permissionResult({
          type: 'deny',
          reason: 'denied',
          execution_class: 'process_execution',
          denial_code: 'policy_denied',
        })),
      },
      tool_execution_service: { executeTool },
    });

    expect(executeTool).not.toHaveBeenCalled();
    expect(result.tool_result_facts.map((toolResult) => toolResult.status)).toEqual(['failed', 'denied']);
    expect(result.next_model_prompt_ready).toBe(true);
  });

  it('creates pending approvals and stops before the next model call', async () => {
    const executeTool = vi.fn();
    const result = await orchestrateToolCallGroup({
      ...baseInput(),
      tool_calls: [toolCall('call-1', 'run_command')],
      registered_tools_by_name: new Map([
        ['run_command', registeredTool('run_command', 'serial')],
      ]),
      permission_service: {
        evaluateToolExecution: vi.fn(() => permissionResult({
          type: 'requires_approval',
          reason: 'needs approval',
          execution_class: 'process_execution',
          approval: { allowed_scopes: ['once', 'session'], default_scope: 'once' },
        })),
      },
      tool_execution_service: { executeTool },
    });

    expect(executeTool).not.toHaveBeenCalled();
    expect(result.pending_approvals).toHaveLength(1);
    expect(result.next_model_prompt_ready).toBe(false);
    expect(result.tool_calls[0]?.status).toBe('waiting_for_approval');
  });

  it('executes allowed tools before an approval barrier and defers tools after it', async () => {
    const executeTool = vi.fn(async (request) => succeededToolResult(request.toolName));
    const result = await orchestrateToolCallGroup({
      ...baseInput(),
      tool_calls: [
        toolCall('call-1', 'read_file'),
        toolCall('call-2', 'run_command'),
        toolCall('call-3', 'list_files'),
      ],
      registered_tools_by_name: new Map([
        ['read_file', registeredTool('read_file', 'parallel')],
        ['run_command', registeredTool('run_command', 'serial')],
        ['list_files', registeredTool('list_files', 'parallel')],
      ]),
      permission_service: {
        evaluateToolExecution: vi.fn((request) => permissionResult(
          request.tool_name === 'run_command'
            ? {
                type: 'requires_approval',
                reason: 'needs approval',
                execution_class: 'process_execution',
                approval: { allowed_scopes: ['once', 'session'], default_scope: 'once' },
              }
            : allowDecision(),
        )),
      },
      tool_execution_service: { executeTool },
    });

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'read_file' }));
    expect(result.pending_approvals).toHaveLength(1);
    expect(result.deferred_tool_calls).toEqual([
      expect.objectContaining({ tool_call_id: 'call-3', tool_name: 'list_files' }),
    ]);
    expect(result.tool_result_facts).toEqual([
      expect.objectContaining({ tool_call_id: 'call-1', status: 'completed' }),
    ]);
    expect(result.next_model_prompt_ready).toBe(false);
  });
});

function baseInput(): Omit<AgentRunToolCallRequest, 'tool_calls' | 'registered_tools_by_name' | 'permission_service' | 'tool_execution_service'> {
  return {
    run_id: 'run-1',
    workspace_id: 'workspace-1',
    workspace_root: 'C:/workspace',
    permission_mode: 'default',
    permission_settings: { allow: [], ask: [], deny: [] },
    runtime_capability_policy: {
      custom_tools_enabled: true,
      process_execution_enabled: true,
      network_enabled: true,
    },
    tool_set: {
      items: [
        { name: 'read_file', description: 'Read file', input_schema: { type: 'object' }, source_tool_name: 'read_file' },
        { name: 'list_files', description: 'List files', input_schema: { type: 'object' }, source_tool_name: 'list_files' },
        { name: 'run_command', description: 'Run command', input_schema: { type: 'object' }, source_tool_name: 'run_command' },
      ],
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
    clock: { now: () => '2026-01-01T00:00:00.000Z' },
    ids: { approval_request_id: () => 'approval-1' },
  };
}

function toolCall(tool_call_id: string, tool_name: string): AgentRunToolCallRequest['tool_calls'][number] {
  return {
    tool_call_id,
    tool_name,
    input: { path: 'README.md' },
  };
}

function allowDecision(): PermissionDecision {
  return {
    type: 'allow',
    reason: 'allowed',
    execution_class: 'read_only',
  };
}

function permissionResult(decision: PermissionDecision): EvaluateToolExecutionResult {
  return {
    status: 'ok',
    decision,
  };
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
      capabilities: name === 'run_command' ? ['command_run'] : ['project_read'],
      riskLevel: name === 'run_command' ? 'high' : 'low',
      sideEffect: name === 'run_command' ? 'execute_command' : 'none',
      availability: { status: 'available' },
      executionMode,
    },
  };
}

function succeededToolResult(toolName: string): ToolExecutionResult {
  return {
    type: 'succeeded',
    toolName,
    rawResult: { outputKind: 'text', content: `${toolName} ok` },
    normalizedResult: {
      kind: 'text',
      content: `${toolName} ok`,
      isError: false,
      truncated: false,
    },
    toolExecutionObservation: {
      summary: `${toolName} ok`,
    },
  };
}
