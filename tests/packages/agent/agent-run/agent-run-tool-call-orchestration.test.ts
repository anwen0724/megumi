// @vitest-environment node
/* Verifies Tool Call ordering across registry, Permissions, approval, and execution. */
import { describe, expect, it, vi } from 'vitest';
import {
  orchestrateToolCallGroup,
  type AgentRunToolCallRequest,
} from '@megumi/agent/agent-run/core/tool-call-orchestrator';
import type { PermissionDecision, PermissionOperation } from '@megumi/agent/permissions';
import type { RegisteredTool, ToolExecutionResult } from '@megumi/agent/tools';
import { Type } from '@megumi/ai';

const operation: PermissionOperation = {
  action: 'workspace.read', resource: { type: 'workspace.path', id: 'C:/workspace/README.md' },
  context: {
    workspace_id: 'workspace-1', session_id: 'session-1', run_id: 'run-1',
    tool_identity: { registered_tool_name: 'read_file', source_id: 'built_in', namespace: 'megumi', source_tool_name: 'read_file' },
  },
};
const allow = (): PermissionDecision => ({ type: 'allow', operations: [operation], safety_assessment: 'safe', reason: 'allowed' });
const deny = (): PermissionDecision => ({ type: 'deny', operations: [operation], safety_assessment: 'safe', reason: 'denied', denial_code: 'rule_denied' });
const approval = (): PermissionDecision => ({
  type: 'requires_approval', operations: [operation], safety_assessment: 'safe', reason: 'ask',
  default_option_id: 'once:call-1', options: [{
    option_id: 'once:call-1', scope: 'once', display: { label: 'Once', description: 'This call.' }, effect: { type: 'current_tool_call' },
  }],
});

describe('tool call orchestration', () => {
  it('fails an unavailable tool before asking Permissions', async () => {
    const evaluateToolCall = vi.fn();
    const result = await orchestrateToolCallGroup({
      ...baseInput(), tool_calls: [toolCall('call-1', 'missing')], registered_tools_by_name: new Map(),
      permission_service: { evaluateToolCall }, tool_execution_service: { executeTool: vi.fn() },
    });
    expect(evaluateToolCall).not.toHaveBeenCalled();
    expect(result.tool_result_facts[0]).toMatchObject({ status: 'failure', error: { code: 'tool_execution_failed' } });
  });

  it('fails invalid Tool input before asking Permissions', async () => {
    const evaluateToolCall = vi.fn();
    const executeTool = vi.fn();
    const invalidCall = { ...toolCall('call-1', 'read_file'), input: {} };
    const result = await orchestrateToolCallGroup({
      ...baseInput(), tool_calls: [invalidCall],
      registered_tools_by_name: new Map([['read_file', registeredTool('read_file')]]),
      permission_service: { evaluateToolCall }, tool_execution_service: { executeTool },
    });
    expect(evaluateToolCall).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
    expect(result.tool_result_facts[0]).toMatchObject({ status: 'failure', error: { code: 'invalid_tool_input' } });
  });

  it('passes stable identity facts to Permissions and the original input to Tool Execution', async () => {
    const executeTool = vi.fn(async () => succeededToolResult('read_file'));
    const evaluateToolCall = vi.fn(async () => ({
      status: 'ok' as const, operations: [operation], decision: allow(),
    }));
    const result = await orchestrateToolCallGroup({
      ...baseInput(), tool_calls: [toolCall('call-1', 'read_file')],
      registered_tools_by_name: new Map([['read_file', registeredTool('read_file')]]),
      permission_service: { evaluateToolCall }, tool_execution_service: { executeTool },
    });
    expect(evaluateToolCall).toHaveBeenCalledWith(expect.objectContaining({
      session_id: 'session-1', workspace_id: 'workspace-1',
      registered_tool: { registered_tool_name: 'read_file', source_id: 'built_in', namespace: 'megumi', source_tool_name: 'read_file' },
    }));
    expect(executeTool).toHaveBeenCalledWith({ toolName: 'read_file', input: { path: 'README.md' } });
    expect(result.tool_result_facts[0]).toMatchObject({ status: 'success' });
  });

  it('creates permission_denied without executing a denied call', async () => {
    const executeTool = vi.fn();
    const result = await orchestrateToolCallGroup({
      ...baseInput(), tool_calls: [toolCall('call-1', 'read_file')],
      registered_tools_by_name: new Map([['read_file', registeredTool('read_file')]]),
      permission_service: { evaluateToolCall: vi.fn(async () => ({ status: 'ok' as const, operations: [operation], decision: deny() })) },
      tool_execution_service: { executeTool },
    });
    expect(executeTool).not.toHaveBeenCalled();
    expect(result.tool_result_facts[0]).toMatchObject({ status: 'permission_denied', error: { code: 'permission_denied' } });
  });

  it('keeps approval options without carrying execution targets in the pending continuation', async () => {
    const result = await orchestrateToolCallGroup({
      ...baseInput(), tool_calls: [toolCall('call-1', 'read_file')],
      registered_tools_by_name: new Map([['read_file', registeredTool('read_file')]]),
      permission_service: { evaluateToolCall: vi.fn(async () => ({
        status: 'ok' as const, operations: [operation], decision: approval(),
      })) },
      tool_execution_service: { executeTool: vi.fn() },
    });
    expect(result.pending_approvals[0]).toMatchObject({
      approval_request: {
        subject: {
          tool_identity: { source_id: 'built_in', namespace: 'megumi', source_tool_name: 'read_file' },
        },
        operations: [expect.objectContaining({ action: 'workspace.read' })],
        options: [{ option_id: 'once:call-1' }],
        default_option_id: 'once:call-1',
      },
    });
    expect(result.pending_approvals[0]).not.toHaveProperty('execution_targets');
    expect(result.deferred_tool_calls).toEqual([]);
  });
});

function baseInput(): Omit<AgentRunToolCallRequest, 'tool_calls' | 'registered_tools_by_name' | 'permission_service' | 'tool_execution_service'> {
  return {
    run_id: 'run-1', session_id: 'session-1', workspace_id: 'workspace-1', workspace_root: 'C:/workspace',
    permission_mode: 'ask', permission_settings: { mode: 'ask', allow: [], ask: [], deny: [] },
    tools: [{ name: 'read_file', description: 'Read file', parameters: Type.Object({}) }],
    workspace_path_policy_service: { classifyPath: vi.fn(() => ({
      absolute_path: 'C:/workspace/README.md', workspace_path: 'README.md', inside_workspace: true, protected: false, sensitive: false,
    })) },
    clock: { now: () => '2026-07-19T00:00:00.000Z' }, ids: { approval_request_id: () => 'approval-1' },
  };
}

function toolCall(id: string, name: string): AgentRunToolCallRequest['tool_calls'][number] {
  return { model_call_id: 'model-1', tool_call_id: id, tool_name: name, input: { path: 'README.md' }, arguments_text: '{"path":"README.md"}' };
}

function registeredTool(name: string): RegisteredTool {
  return {
    identity: { sourceId: 'built_in', namespace: 'megumi', sourceToolName: name }, registeredToolName: name,
    source: { sourceId: 'built_in', sourceKind: 'built_in', namespace: 'megumi', displayName: 'Built in', configured: true, enabled: true, availabilityStatus: 'available' },
    status: 'available',
    definition: {
      name,
      description: name,
      inputSchema: {
        type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false,
      },
      capabilities: ['project_read'], riskLevel: 'low', sideEffect: 'none', availability: { status: 'available' }, executionMode: 'serial',
    },
  };
}

function succeededToolResult(toolName: string): ToolExecutionResult {
  return { type: 'succeeded', toolName, rawResult: { outputKind: 'text', content: 'ok' }, normalizedResult: { kind: 'text', content: 'ok', isError: false, truncated: false } };
}
