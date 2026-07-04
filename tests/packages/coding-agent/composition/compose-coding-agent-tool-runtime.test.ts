// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { composeCodingAgentToolRuntimeFactory } from '@megumi/coding-agent/composition/compose-coding-agent-tool-runtime';
import { ToolRegistryService } from '@megumi/coding-agent/tools';
import { createWorkspacePathPolicyService } from '@megumi/coding-agent/workspace';

describe('composeCodingAgentToolRuntimeFactory', () => {
  it('resolves permission settings with the current session id', async () => {
    const requests: unknown[] = [];
    const factory = composeCodingAgentToolRuntimeFactory({
      toolRepository: {} as never,
      toolRegistry: new ToolRegistryService(),
      workspaceChangeService: {} as never,
      workspacePathPolicyService: createWorkspacePathPolicyService(),
      runRepository: {} as never,
      permissionService: {} as never,
      permissionSettingsResolver: {
        resolvePermissionSettings(request) {
          requests.push(request);
          return {
            status: 'ok',
            permission_settings: {
              allow: [{ source: 'session', source_id: 'session_1', pattern: 'tool:run_command|command=npm test' }],
              ask: [],
              deny: [],
            },
          };
        },
      },
    });

    await factory.create({
      sessionId: 'session_1',
      projectRoot: 'C:/repo',
      permissionMode: 'default',
    });

    expect(requests).toEqual([{
      workspace_id: 'C:/repo',
      session_id: 'session_1',
    }]);
  });
});
