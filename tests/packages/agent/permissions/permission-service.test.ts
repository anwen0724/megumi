// @vitest-environment node
/* Verifies action resolution, safety policy, rule order, modes, and approval effects. */
import { describe, expect, it } from 'vitest';
import { createPermissionService, type PermissionRule } from '@megumi/agent/permissions';

class FakeSettingsApplyService {
  requests: unknown[] = [];
  failure?: { code: string; message: string };
  async addPermissionRules(request: unknown) {
    this.requests.push(request);
    return this.failure ? { status: 'failed' as const, failure: this.failure } : { status: 'saved' as const };
  }
}

const identity = (name: string) => ({
  registered_tool_name: name, source_id: 'built_in', namespace: 'megumi', source_tool_name: name,
});

const baseRequest = (overrides: Record<string, unknown> = {}) => ({
  run_id: 'run_1', session_id: 'session_1', workspace_id: 'workspace_1', tool_call_id: 'call_1',
  tool_input: { command: 'npm test' }, registered_tool: identity('run_command'),
  permission_mode: 'ask' as const,
  permission_settings: { mode: 'ask' as const, allow: [], ask: [], deny: [] },
  evaluated_at: '2026-07-19T00:00:00.000Z',
  ...overrides,
});

describe('Permission Service', () => {
  it('resolves built-ins without trusting ToolDefinition risk metadata', async () => {
    const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });
    const result = await service.evaluateToolCall(baseRequest({
      registered_tool: identity('write_file'), tool_input: { path: 'src/a.ts', content: 'x' },
      workspace_path: { absolute_path: 'C:/work/src/a.ts', workspace_path: 'src/a.ts', inside_workspace: true, protected: false, sensitive: false },
    }));
    expect(result).toMatchObject({ status: 'ok', operations: [{ action: 'workspace.write', resource: { type: 'workspace.path', id: 'src/a.ts' } }], decision: { type: 'requires_approval', safety_assessment: 'safe' } });
  });

  it('treats prohibited as approvable and full access as allowed', async () => {
    const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });
    const prohibited = { absolute_path: 'C:/outside/a.ts', workspace_path: '../outside/a.ts', inside_workspace: false, protected: false, sensitive: false };
    expect(await service.evaluateToolCall(baseRequest({ registered_tool: identity('write_file'), tool_input: { path: '../outside/a.ts' }, workspace_path: prohibited, permission_mode: 'auto' })))
      .toMatchObject({ decision: { type: 'requires_approval', safety_assessment: 'prohibited' } });
    expect(await service.evaluateToolCall(baseRequest({ registered_tool: identity('write_file'), tool_input: { path: '../outside/a.ts' }, workspace_path: prohibited, permission_mode: 'full_access' })))
      .toMatchObject({ decision: { type: 'allow', safety_assessment: 'prohibited' } });
  });

  it('keeps an outside-Workspace path absolute for policy matching and approval display', async () => {
    const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });
    const result = await service.evaluateToolCall(baseRequest({
      registered_tool: identity('write_file'),
      tool_input: { path: '../outside/a.ts' },
      workspace_path: { absolute_path: 'C:/outside/a.ts', workspace_path: '../outside/a.ts', inside_workspace: false, protected: false, sensitive: false },
    }));

    expect(result).toMatchObject({ operations: [{ resource: { id: 'C:/outside/a.ts' } }] });
  });

  it('uses deny then ask then allow before mode defaults', async () => {
    const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });
    const toolRule = (source: PermissionRule['source']): PermissionRule => ({ source, ...(source === 'session' ? { source_id: 'session_1' } : {}), target: { kind: 'tool', tool_identity: { source_id: 'built_in', namespace: 'megumi', source_tool_name: 'run_command' } } });
    const decision = await service.evaluateToolCall(baseRequest({
      permission_mode: 'full_access',
      permission_settings: { mode: 'full_access', allow: [toolRule('user')], ask: [toolRule('user')], deny: [toolRule('user')] },
    }));
    expect(decision).toMatchObject({ decision: { type: 'deny', denial_code: 'rule_denied' } });
    const asked = await service.evaluateToolCall(baseRequest({
      permission_mode: 'full_access',
      permission_settings: { mode: 'full_access', allow: [toolRule('user')], ask: [toolRule('user')], deny: [] },
    }));
    expect(asked).toMatchObject({ decision: { type: 'requires_approval' } });
  });

  it('uses external.invoke for registered tools without a trusted resolver', async () => {
    const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });
    const result = await service.evaluateToolCall(baseRequest({ registered_tool: { registered_tool_name: 'mcp_calendar', source_id: 'mcp:calendar', namespace: 'calendar', source_tool_name: 'create_event' }, tool_input: {} }));
    expect(result).toMatchObject({ operations: [{ action: 'external.invoke', resource: { type: 'tool.identity' } }], decision: { type: 'requires_approval', safety_assessment: 'prohibited', options: [{ scope: 'once' }, { scope: 'session' }] } });
  });

  it('normalizes a web URL for rule matching without producing execution targets', async () => {
    const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });
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
    const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });
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
    const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });
    const sessionGrant: PermissionRule = {
      source: 'session', source_id: 'session_1',
      target: { kind: 'tool', tool_identity: { source_id: 'built_in', namespace: 'megumi', source_tool_name: 'run_command' } },
    };
    const granted = await service.evaluateToolCall(baseRequest({
      tool_input: { command: 'npm run build' },
      permission_settings: { mode: 'ask', allow: [sessionGrant], ask: [], deny: [] },
    }));
    expect(granted).toMatchObject({ decision: { type: 'allow' } });

    const asked = await service.evaluateToolCall(baseRequest({
      tool_input: { command: 'npm run package' },
      permission_settings: { mode: 'ask', allow: [sessionGrant], ask: [sessionGrant], deny: [] },
    }));
    expect(asked).toMatchObject({ decision: { type: 'requires_approval' } });
  });

  it('allows context activation but does not authorize later tools', async () => {
    const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });
    const result = await service.evaluateToolCall(baseRequest({
      registered_tool: identity('use_skill'),
      tool_input: { skillPath: 'C:/skills/x/SKILL.md' },
    }));
    expect(result).toMatchObject({ operations: [{ action: 'agent.context.activate' }], decision: { type: 'allow', safety_assessment: 'safe' } });
  });

  it('applies once without settings and session by the original immutable option', async () => {
    const settings = new FakeSettingsApplyService();
    const service = createPermissionService({ settings_service: settings });
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
    const service = createPermissionService({ settings_service: settings });
    const evaluated = await service.evaluateToolCall(baseRequest());
    if (evaluated.status !== 'ok' || evaluated.decision.type !== 'requires_approval') throw new Error('approval expected');
    await expect(service.applyApprovalDecision({
      original_permission_decision: evaluated.decision, session_id: 'session_1', applied_at: '2026-07-19T00:00:02.000Z',
      decision: { approval_request_id: 'approval_1', decision: 'approved', option_id: 'forged', decided_by: 'user', decided_at: '2026-07-19T00:00:02.000Z' },
    })).resolves.toMatchObject({ status: 'rejected', reason: 'option_not_found' });
    expect(settings.requests).toHaveLength(0);
  });

  it('rejects approval application when the original decision did not require approval', async () => {
    const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });
    const evaluated = await service.evaluateToolCall(baseRequest({ permission_mode: 'full_access' }));
    if (evaluated.status !== 'ok') throw new Error('permission evaluation expected');
    await expect(service.applyApprovalDecision({
      original_permission_decision: evaluated.decision,
      session_id: 'session_1', applied_at: '2026-07-19T00:00:02.000Z',
      decision: { approval_request_id: 'approval_1', decision: 'denied', decided_by: 'user', decided_at: '2026-07-19T00:00:02.000Z' },
    })).resolves.toMatchObject({ status: 'rejected', reason: 'decision_not_allowed' });
  });

  it('returns structured failures for invalid runtime requests', async () => {
    const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });
    expect(await service.evaluateToolCall({ ...baseRequest(), permission_mode: 'custom' } as never))
      .toMatchObject({ status: 'failed', failure: { code: 'permission_request_invalid' } });
    await expect(service.applyApprovalDecision({
      original_permission_decision: { type: 'allow' },
      decision: { decision: 'approved' },
    } as never)).resolves.toMatchObject({ status: 'failed', failure: { code: 'approval_request_invalid' } });
  });
});
