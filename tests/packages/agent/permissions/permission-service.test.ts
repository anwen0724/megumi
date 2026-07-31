// @vitest-environment node
/* Verifies action resolution, safety policy, rule order, modes, and approval effects. */
import { describe, expect, it } from 'vitest';
import { createPermissionService, type PermissionRule } from '@megumi/agent/permissions';

class FakeSettingsApplyService {
  requests: unknown[] = [];
  failure?: { code: string; message: string };
  permissionSettings = { mode: 'ask' as const, allow: [] as PermissionRule[], ask: [] as PermissionRule[], deny: [] as PermissionRule[] };
  resolveRequests: unknown[] = [];

  resolvePermissionSettings(request: unknown) {
    this.resolveRequests.push(request);
    return this.failure
      ? { status: 'failed' as const, failure: this.failure }
      : { status: 'ok' as const, permission_settings: this.permissionSettings };
  }

  async addPermissionRules(request: unknown) {
    this.requests.push(request);
    return this.failure ? { status: 'failed' as const, failure: this.failure } : { status: 'saved' as const };
  }
}

class FakeWorkspacePathPolicy {
  requests: Array<{ workspace_id: string; target_path: string }> = [];
  failure?: { code: string; message: string };

  classifyPath(request: { workspace_id: string; target_path: string }) {
    this.requests.push(request);
    if (this.failure) {
      return {
        status: 'failed' as const,
        failure: this.failure,
      };
    }
    const outside = request.target_path.startsWith('../');
    return {
      status: 'classified' as const,
      workspace_path: {
        absolute_path: outside
          ? `C:/${request.target_path.slice(3)}`
          : `C:/work/${request.target_path}`,
        workspace_path: request.target_path,
        inside_workspace: !outside,
        protected: false,
        sensitive: false,
      },
    };
  }
}

function createService(
  settings = new FakeSettingsApplyService(),
  workspacePathPolicy = new FakeWorkspacePathPolicy(),
) {
  return createPermissionService({
    settings_service: settings,
    workspace_path_policy: workspacePathPolicy,
  });
}

const identity = (name: string) => ({
  registered_tool_name: name, source_id: 'built_in', namespace: 'megumi', source_tool_name: name,
});

const baseRequest = (overrides: Record<string, unknown> = {}) => ({
  run_id: 'run_1', session_id: 'session_1', workspace_id: 'workspace_1', tool_call_id: 'call_1',
  tool_input: { command: 'npm test' }, registered_tool: identity('run_command'),
  permission_mode: 'ask' as const,
  evaluated_at: '2026-07-19T00:00:00.000Z',
  ...overrides,
});

describe('Permission Service', () => {
  it('resolves built-ins without trusting ToolDefinition risk metadata', async () => {
    const workspacePathPolicy = new FakeWorkspacePathPolicy();
    const service = createService(new FakeSettingsApplyService(), workspacePathPolicy);
    const result = await service.evaluateToolCall(baseRequest({
      registered_tool: identity('write_file'), tool_input: { path: 'src/a.ts', content: 'x' },
    }));
    expect(result).toMatchObject({ status: 'ok', operations: [{ action: 'workspace.write', resource: { type: 'workspace.path', id: 'src/a.ts' } }], decision: { type: 'requires_approval', safety_assessment: 'safe' } });
    expect(workspacePathPolicy.requests).toEqual([
      { workspace_id: 'workspace_1', target_path: 'src/a.ts' },
    ]);
  });

  it('treats prohibited as approvable and full access as allowed', async () => {
    const service = createService();
    expect(await service.evaluateToolCall(baseRequest({ registered_tool: identity('write_file'), tool_input: { path: '../outside/a.ts' }, permission_mode: 'auto' })))
      .toMatchObject({ decision: { type: 'requires_approval', safety_assessment: 'prohibited' } });
    expect(await service.evaluateToolCall(baseRequest({ registered_tool: identity('write_file'), tool_input: { path: '../outside/a.ts' }, permission_mode: 'full_access' })))
      .toMatchObject({ decision: { type: 'allow', safety_assessment: 'prohibited' } });
  });

  it('keeps an outside-Workspace path absolute for policy matching and approval display', async () => {
    const service = createService();
    const result = await service.evaluateToolCall(baseRequest({
      registered_tool: identity('write_file'),
      tool_input: { path: '../outside/a.ts' },
    }));

    expect(result).toMatchObject({ operations: [{ resource: { id: 'C:/outside/a.ts' } }] });
  });

  it('uses deny then ask then allow before mode defaults', async () => {
    const toolRule = (source: PermissionRule['source']): PermissionRule => ({ source, ...(source === 'session' ? { source_id: 'session_1' } : {}), target: { kind: 'tool', tool_identity: { source_id: 'built_in', namespace: 'megumi', source_tool_name: 'run_command' } } });
    const settings = new FakeSettingsApplyService();
    settings.permissionSettings = { mode: 'ask', allow: [toolRule('user')], ask: [toolRule('user')], deny: [toolRule('user')] };
    const service = createService(settings);
    const decision = await service.evaluateToolCall(baseRequest({
      permission_mode: 'full_access',
    }));
    expect(decision).toMatchObject({ decision: { type: 'deny', denial_code: 'rule_denied' } });
    settings.permissionSettings = { mode: 'ask', allow: [toolRule('user')], ask: [toolRule('user')], deny: [] };
    const asked = await service.evaluateToolCall(baseRequest({
      permission_mode: 'full_access',
    }));
    expect(asked).toMatchObject({ decision: { type: 'requires_approval' } });
    expect(settings.resolveRequests).toEqual([
      { workspace_id: 'workspace_1', session_id: 'session_1' },
      { workspace_id: 'workspace_1', session_id: 'session_1' },
    ]);
  });

  it('uses external.invoke for registered tools without a trusted resolver', async () => {
    const service = createService();
    const result = await service.evaluateToolCall(baseRequest({ registered_tool: { registered_tool_name: 'mcp_calendar', source_id: 'mcp:calendar', namespace: 'calendar', source_tool_name: 'create_event' }, tool_input: {} }));
    expect(result).toMatchObject({ operations: [{ action: 'external.invoke', resource: { type: 'tool.identity' } }], decision: { type: 'requires_approval', safety_assessment: 'prohibited', options: [{ scope: 'once' }, { scope: 'session' }] } });
  });

  it('normalizes a web URL for rule matching without producing execution targets', async () => {
    const service = createService();
    const result = await service.evaluateToolCall(baseRequest({
      registered_tool: identity('web_fetch'),
      tool_input: { url: 'https://EXAMPLE.com/docs' },
      permission_mode: 'auto',
    }));

    expect(result).toMatchObject({
      operations: [{
        action: 'network.fetch',
        resource: { type: 'network.url', id: 'https://example.com/docs', attributes: { hostname: 'example.com' } },
      }],
      decision: { type: 'allow', safety_assessment: 'safe' },
    });
    expect(result).not.toHaveProperty('execution_targets');
  });

  it('does not run Tool Runtime network analysis into a Permission decision', async () => {
    const service = createService();
    const result = await service.evaluateToolCall(baseRequest({
      registered_tool: identity('web_fetch'),
      tool_input: { url: 'http://127.0.0.1/private' },
      permission_mode: 'auto',
    }));

    expect(result).toMatchObject({
      operations: [{
        action: 'network.fetch',
        resource: { type: 'network.url', attributes: { hostname: '127.0.0.1' } },
      }],
      decision: { type: 'allow', safety_assessment: 'safe' },
    });
  });

  it('lets a Session Tool Grant cover different inputs while explicit ask still overrides it', async () => {
    const sessionGrant: PermissionRule = {
      source: 'session', source_id: 'session_1',
      target: { kind: 'tool', tool_identity: { source_id: 'built_in', namespace: 'megumi', source_tool_name: 'run_command' } },
    };
    const settings = new FakeSettingsApplyService();
    settings.permissionSettings = { mode: 'ask', allow: [sessionGrant], ask: [], deny: [] };
    const service = createService(settings);
    const granted = await service.evaluateToolCall(baseRequest({
      tool_input: { command: 'npm run build' },
    }));
    expect(granted).toMatchObject({ decision: { type: 'allow' } });

    settings.permissionSettings = { mode: 'ask', allow: [sessionGrant], ask: [sessionGrant], deny: [] };
    const asked = await service.evaluateToolCall(baseRequest({
      tool_input: { command: 'npm run package' },
    }));
    expect(asked).toMatchObject({ decision: { type: 'requires_approval' } });
  });

  it('allows context activation but does not authorize later tools', async () => {
    const service = createService();
    const result = await service.evaluateToolCall(baseRequest({
      registered_tool: identity('use_skill'),
      tool_input: { skillPath: 'C:/skills/x/SKILL.md' },
    }));
    expect(result).toMatchObject({ operations: [{ action: 'agent.context.activate' }], decision: { type: 'allow', safety_assessment: 'safe' } });
  });

  it('applies once without settings and session by the original immutable option', async () => {
    const settings = new FakeSettingsApplyService();
    const service = createService(settings);
    const evaluated = await service.evaluateToolCall(baseRequest());
    if (evaluated.status !== 'ok' || evaluated.decision.type !== 'requires_approval') throw new Error('approval expected');
    const once = await service.applyApprovalDecision({
      original_permission_decision: evaluated.decision, session_id: 'session_1', applied_at: '2026-07-19T00:00:01.000Z',
      decision: { approval_request_id: 'approval_1', decision: 'approved', option_id: evaluated.decision.default_option_id, decided_by: 'user', decided_at: '2026-07-19T00:00:01.000Z' },
    });
    expect(once).toEqual({ status: 'applied', effect: { type: 'none' } });
    expect(settings.requests).toHaveLength(0);
    const sessionOption = evaluated.decision.options.find((option) => option.scope === 'session');
    const session = await service.applyApprovalDecision({
      original_permission_decision: evaluated.decision, session_id: 'session_1', applied_at: '2026-07-19T00:00:02.000Z',
      decision: { approval_request_id: 'approval_1', decision: 'approved', option_id: sessionOption?.option_id, decided_by: 'user', decided_at: '2026-07-19T00:00:02.000Z' },
    });
    expect(session).toMatchObject({ status: 'applied', effect: { type: 'session_tool_grant' } });
    expect(settings.requests).toHaveLength(1);
  });

  it('rejects unknown options without writing settings', async () => {
    const settings = new FakeSettingsApplyService();
    const service = createService(settings);
    const evaluated = await service.evaluateToolCall(baseRequest());
    if (evaluated.status !== 'ok' || evaluated.decision.type !== 'requires_approval') throw new Error('approval expected');
    await expect(service.applyApprovalDecision({
      original_permission_decision: evaluated.decision, session_id: 'session_1', applied_at: '2026-07-19T00:00:02.000Z',
      decision: { approval_request_id: 'approval_1', decision: 'approved', option_id: 'forged', decided_by: 'user', decided_at: '2026-07-19T00:00:02.000Z' },
    })).resolves.toMatchObject({ status: 'rejected', reason: 'option_not_found' });
    expect(settings.requests).toHaveLength(0);
  });

  it('rejects approval application when the original decision did not require approval', async () => {
    const service = createService();
    const evaluated = await service.evaluateToolCall(baseRequest({ permission_mode: 'full_access' }));
    if (evaluated.status !== 'ok') throw new Error('permission evaluation expected');
    await expect(service.applyApprovalDecision({
      original_permission_decision: evaluated.decision,
      session_id: 'session_1', applied_at: '2026-07-19T00:00:02.000Z',
      decision: { approval_request_id: 'approval_1', decision: 'denied', decided_by: 'user', decided_at: '2026-07-19T00:00:02.000Z' },
    })).resolves.toMatchObject({ status: 'rejected', reason: 'decision_not_allowed' });
  });

  it('returns structured failures for invalid runtime requests', async () => {
    const service = createService();
    expect(await service.evaluateToolCall({ ...baseRequest(), permission_mode: 'custom' } as never))
      .toMatchObject({ status: 'failed', failure: { code: 'permission_request_invalid' } });
    expect(await service.evaluateToolCall({
      ...baseRequest(),
      permission_settings: { mode: 'ask', allow: [], ask: [], deny: [] },
    } as never)).toMatchObject({
      status: 'failed',
      failure: { code: 'permission_request_invalid' },
    });
    expect(await service.evaluateToolCall({
      ...baseRequest(),
      workspace_path: {
        absolute_path: 'C:/forged/a.ts',
        workspace_path: 'a.ts',
        inside_workspace: true,
        protected: false,
        sensitive: false,
      },
    } as never)).toMatchObject({
      status: 'failed',
      failure: { code: 'permission_request_invalid' },
    });
    await expect(service.applyApprovalDecision({
      original_permission_decision: { type: 'allow' },
      decision: { decision: 'approved' },
    } as never)).resolves.toMatchObject({ status: 'failed', failure: { code: 'approval_request_invalid' } });
  });

  it('returns a Permission-owned failure when Settings rules cannot be resolved', async () => {
    const settings = new FakeSettingsApplyService();
    settings.failure = { code: 'settings_raw_invalid', message: 'raw provider body must not escape' };
    const service = createService(settings);

    await expect(service.evaluateToolCall(baseRequest())).resolves.toEqual({
      status: 'failed',
      failure: {
        code: 'permission_settings_failed',
        message: 'Permission settings could not be resolved.',
        details: { settings_failure_code: 'settings_raw_invalid' },
      },
    });
  });

  it('returns a Permission-owned failure when Workspace path classification fails', async () => {
    const workspacePathPolicy = new FakeWorkspacePathPolicy();
    workspacePathPolicy.failure = {
      code: 'workspace_not_found',
      message: 'raw workspace failure must not escape',
    };
    const service = createService(new FakeSettingsApplyService(), workspacePathPolicy);

    await expect(service.evaluateToolCall(baseRequest({
      registered_tool: identity('write_file'),
      tool_input: { path: 'src/a.ts', content: 'x' },
    }))).resolves.toEqual({
      status: 'failed',
      failure: {
        code: 'permission_workspace_path_failed',
        message: 'Workspace path could not be classified.',
        details: { workspace_failure_code: 'workspace_not_found' },
      },
    });
  });
});
