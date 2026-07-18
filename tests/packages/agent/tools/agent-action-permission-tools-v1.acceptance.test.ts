// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createPermissionService,
  type PermissionMode,
  type RegisteredToolPermissionFacts,
} from '@megumi/agent/permissions';

const permissionService = createPermissionService({
  settings_service: {
    async addPermissionRule() {
      return { status: 'saved' };
    },
  },
});

describe('agent action permission tools v1 acceptance', () => {
  it('allows read tools in the conservative baseline', async () => {
    const result = await permissionService.evaluateToolExecution({
      run_id: 'run_1',
      tool_call_id: 'tool_call_1',
      tool_name: 'read_file',
      tool_input: { path: 'README.md' },
      registered_tool: toolFacts({
        registered_tool_name: 'read_file',
        source_tool_name: 'read_file',
        capabilities: ['project_read'],
        risk_level: 'low',
        side_effect: 'none',
      }),
      permission_mode: 'default',
      permission_settings: { allow: [], ask: [], deny: [] },
      workspace_path: {
        inside_workspace: true,
        protected: false,
        sensitive: false,
        workspace_path: 'README.md',
      },
      runtime_capability_policy: {
        custom_tools_enabled: true,
        process_execution_enabled: true,
        network_enabled: true,
      },
      evaluated_at: '2026-05-20T00:00:00.000Z',
    });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.decision.type).toBe('allow');
    }
  });

  it('requires approval for writes and verification commands in every V1 permission mode', async () => {
    const modes: PermissionMode[] = ['default', 'accept_edits', 'plan', 'auto'];

    for (const permissionMode of modes) {
      const writeDecision = await permissionService.evaluateToolExecution(baseRequest({
        permission_mode: permissionMode,
        tool_name: 'write_file',
        tool_input: { path: 'src/index.ts', content: 'export {}' },
        registered_tool: toolFacts({
          registered_tool_name: 'write_file',
          source_tool_name: 'write_file',
          capabilities: ['project_write'],
          risk_level: 'medium',
          side_effect: 'project_file_operation',
        }),
      }));
      const commandDecision = await permissionService.evaluateToolExecution(baseRequest({
        permission_mode: permissionMode,
        tool_name: 'run_command',
        tool_input: { command: 'npm test' },
        registered_tool: toolFacts({
          registered_tool_name: 'run_command',
          source_tool_name: 'run_command',
          capabilities: ['command_run'],
          risk_level: 'medium',
          side_effect: 'process_execution',
        }),
      }));

      expect(writeDecision.status).toBe('ok');
      expect(commandDecision.status).toBe('ok');
      if (writeDecision.status === 'ok' && commandDecision.status === 'ok') {
        expect(writeDecision.decision.type).toBe('requires_approval');
        expect(commandDecision.decision.type).toBe('requires_approval');
      }
    }
  });

  it('denies protected path writes', async () => {
    const result = await permissionService.evaluateToolExecution(baseRequest({
      tool_name: 'write_file',
      tool_input: { path: '.git/config', content: '[core]' },
      registered_tool: toolFacts({
        registered_tool_name: 'write_file',
        source_tool_name: 'write_file',
        capabilities: ['project_write'],
        risk_level: 'medium',
        side_effect: 'project_file_operation',
      }),
      workspace_path: {
        inside_workspace: true,
        protected: true,
        sensitive: false,
        workspace_path: '.git/config',
      },
    }));

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.decision).toMatchObject({
        type: 'deny',
        denial_code: 'protected_path',
      });
    }
  });
});

function baseRequest(overrides: Partial<Parameters<typeof permissionService.evaluateToolExecution>[0]> = {}) {
  return {
    run_id: 'run_1',
    tool_call_id: 'tool_call_1',
    tool_name: 'run_command',
    tool_input: { command: 'npm test' },
    registered_tool: toolFacts(),
    permission_mode: 'default' as const,
    permission_settings: { allow: [], ask: [], deny: [] },
    workspace_path: {
      inside_workspace: true,
      protected: false,
      sensitive: false,
    },
    runtime_capability_policy: {
      custom_tools_enabled: true,
      process_execution_enabled: true,
      network_enabled: true,
    },
    evaluated_at: '2026-05-20T00:00:00.000Z',
    ...overrides,
  };
}

function toolFacts(overrides: Partial<RegisteredToolPermissionFacts> = {}): RegisteredToolPermissionFacts {
  return {
    registered_tool_name: 'run_command',
    source_id: 'built_in',
    source_tool_name: 'run_command',
    capabilities: ['command_run'],
    risk_level: 'medium',
    side_effect: 'process_execution',
    ...overrides,
  };
}
