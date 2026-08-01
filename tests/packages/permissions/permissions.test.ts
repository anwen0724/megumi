// @vitest-environment node
/* Verifies operation resolution, policy order, modes, immutable approval subjects, and persistence effects. */
import { describe, expect, it } from 'vitest';
import {
  createPermissions,
  type ApprovalSubject,
  type EvaluateToolCallRequest,
  type PermissionRule,
  type PermissionRuleReader,
  type PermissionRuleWriter,
  type PermissionSettings,
  type PermissionWorkspacePathClassifier,
} from '../../../packages/permissions/src/index';
import type { RegisteredTool, ToolShellKind } from '../../../packages/tools/src/index';

class FakeRuleAccess implements PermissionRuleReader, PermissionRuleWriter {
  readonly writes: unknown[] = [];
  settings: PermissionSettings = { mode: 'ask', allow: [], ask: [], deny: [] };
  failure?: { code: string; message: string };

  resolvePermissionRules() {
    return this.failure
      ? { status: 'failed' as const, failure: this.failure }
      : { status: 'resolved' as const, permissionSettings: this.settings };
  }

  async addPermissionRules(request: unknown) {
    this.writes.push(request);
    return this.failure
      ? { status: 'failed' as const, failure: this.failure }
      : { status: 'saved' as const };
  }
}

class FakePathClassifier implements PermissionWorkspacePathClassifier {
  readonly requests: Array<{ workspaceId: string; targetPath: string }> = [];
  classifyWorkspacePath(request: { workspaceId: string; targetPath: string }) {
    this.requests.push(request);
    const outside = request.targetPath.startsWith('../');
    return {
      status: 'classified' as const,
      workspacePath: {
        absolutePath: outside ? `C:/${request.targetPath.slice(3)}` : `C:/work/${request.targetPath}`,
        workspacePath: request.targetPath,
        insideWorkspace: !outside,
        protected: false,
        sensitive: false,
      },
    };
  }
}

function registeredTool(name: string, shellKind: ToolShellKind | 'unknown' = 'powershell'): RegisteredTool {
  const sideEffect = name === 'run_command'
    ? 'execute_command'
    : name === 'write_file'
      ? 'project_file_operation'
      : name.startsWith('web_')
        ? 'access_network'
        : 'none';
  return {
    identity: { sourceId: 'built_in', namespace: 'megumi', sourceToolName: name },
    registeredToolName: name,
    source: {
      sourceId: 'built_in', sourceKind: 'built_in', namespace: 'megumi', displayName: 'Built in',
      configured: true, enabled: true, availabilityStatus: 'available',
    },
    definition: {
      name,
      description: name,
      inputSchema: { type: 'object' },
      capabilities: name === 'run_command' ? ['command_run'] : [],
      riskLevel: 'low',
      sideEffect,
      availability: { status: 'available' },
      permissionMetadata: {
        ruleToolName: name,
        ...(name === 'run_command' ? { shellKind, executionMethod: 'shell' } : {}),
      },
    },
    status: 'available',
  };
}

function externalTool(): RegisteredTool {
  return {
    ...registeredTool('create_event'),
    identity: { sourceId: 'mcp:calendar', namespace: 'calendar', sourceToolName: 'create_event' },
    registeredToolName: 'calendar_create_event',
    source: {
      sourceId: 'mcp:calendar', sourceKind: 'mcp', namespace: 'calendar', displayName: 'Calendar',
      configured: true, enabled: true, availabilityStatus: 'available',
    },
    definition: {
      ...registeredTool('create_event').definition,
      permissionMetadata: undefined,
      sideEffect: 'modify_external',
    },
  };
}

function baseRequest(overrides: Partial<EvaluateToolCallRequest> = {}): EvaluateToolCallRequest {
  return {
    runId: 'run_1',
    sessionId: 'session_1',
    workspaceId: 'workspace_1',
    toolCallId: 'call_1',
    toolInput: { command: 'npm test' },
    registeredTool: registeredTool('run_command'),
    permissionMode: 'ask',
    evaluatedAt: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}

function createFixture() {
  const ruleAccess = new FakeRuleAccess();
  const pathClassifier = new FakePathClassifier();
  return {
    ruleAccess,
    pathClassifier,
    permissions: createPermissions({
      ruleReader: ruleAccess,
      ruleWriter: ruleAccess,
      workspacePathClassifier: pathClassifier,
    }),
  };
}

describe('Permissions', () => {
  it('resolves built-ins from trusted Tool identity and metadata', async () => {
    const fixture = createFixture();
    const result = await fixture.permissions.evaluateToolCall(baseRequest({
      registeredTool: registeredTool('write_file'),
      toolInput: { path: 'src/a.ts', content: 'x' },
    }));
    expect(result).toMatchObject({
      status: 'ok',
      operations: [{ action: 'workspace.write', resource: { type: 'workspace.path', id: 'src/a.ts' } }],
      decision: { type: 'requires_approval', safetyAssessment: 'safe' },
    });
    expect(fixture.pathClassifier.requests).toEqual([
      { workspaceId: 'workspace_1', targetPath: 'src/a.ts' },
    ]);
  });

  it('classifies source and destination separately for path-to-path actions', async () => {
    const fixture = createFixture();
    const result = await fixture.permissions.evaluateToolCall(baseRequest({
      registeredTool: registeredTool('copy_path'),
      toolInput: { source: 'notes/a.md', destination: 'archive/a.md', overwrite: false },
    }));
    expect(result).toMatchObject({ status: 'ok', operations: [
      { action: 'workspace.read', resource: { id: 'notes/a.md' } },
      { action: 'workspace.write', resource: { id: 'archive/a.md' } },
    ] });
    expect(fixture.pathClassifier.requests).toEqual([
      { workspaceId: 'workspace_1', targetPath: 'notes/a.md' },
      { workspaceId: 'workspace_1', targetPath: 'archive/a.md' },
    ]);
  });
  it('keeps deny then ask then allow before the selected mode', async () => {
    const fixture = createFixture();
    const toolRule: PermissionRule = {
      source: 'user',
      target: {
        kind: 'tool',
        tool_identity: { source_id: 'built_in', namespace: 'megumi', source_tool_name: 'run_command' },
      },
    };
    fixture.ruleAccess.settings = {
      mode: 'ask', allow: [toolRule], ask: [toolRule], deny: [toolRule],
    };
    expect(await fixture.permissions.evaluateToolCall(baseRequest({ permissionMode: 'full_access' })))
      .toMatchObject({ decision: { type: 'deny', denialCode: 'rule_denied' } });
    fixture.ruleAccess.settings = { mode: 'ask', allow: [toolRule], ask: [toolRule], deny: [] };
    expect(await fixture.permissions.evaluateToolCall(baseRequest({ permissionMode: 'full_access' })))
      .toMatchObject({ decision: { type: 'requires_approval' } });
  });

  it('keeps prohibited operations approvable while full access remains explicit', async () => {
    const fixture = createFixture();
    expect(await fixture.permissions.evaluateToolCall(baseRequest({
      registeredTool: registeredTool('write_file'),
      toolInput: { path: '../outside/a.ts', content: 'x' },
      permissionMode: 'auto',
    }))).toMatchObject({ decision: { type: 'requires_approval', safetyAssessment: 'prohibited' } });
    expect(await fixture.permissions.evaluateToolCall(baseRequest({
      registeredTool: registeredTool('write_file'),
      toolInput: { path: '../outside/a.ts', content: 'x' },
      permissionMode: 'full_access',
    }))).toMatchObject({ decision: { type: 'allow', safetyAssessment: 'prohibited' } });
  });

  it('fails closed for unknown shell kinds and untrusted external tools', async () => {
    const fixture = createFixture();
    expect(await fixture.permissions.evaluateToolCall(baseRequest({
      registeredTool: registeredTool('run_command', 'unknown'),
      permissionMode: 'auto',
    }))).toMatchObject({ decision: { type: 'requires_approval', safetyAssessment: 'prohibited' } });
    expect(await fixture.permissions.evaluateToolCall(baseRequest({
      registeredTool: externalTool(),
      toolInput: { title: 'meeting' },
      permissionMode: 'auto',
    }))).toMatchObject({
      operations: [{ action: 'external.invoke', resource: { type: 'tool.identity' } }],
      decision: { type: 'requires_approval', safetyAssessment: 'prohibited' },
    });
  });

  it('normalizes Web URLs without turning Tool runtime checks into Permission facts', async () => {
    const fixture = createFixture();
    expect(await fixture.permissions.evaluateToolCall(baseRequest({
      registeredTool: registeredTool('web_fetch'),
      toolInput: { url: 'https://EXAMPLE.com/docs' },
      permissionMode: 'auto',
    }))).toMatchObject({
      operations: [{
        action: 'network.fetch',
        resource: {
          type: 'network.url',
          id: 'https://example.com/docs',
          attributes: { hostname: 'example.com' },
        },
      }],
      decision: { type: 'allow', safetyAssessment: 'safe' },
    });
    expect(await fixture.permissions.evaluateToolCall(baseRequest({
      registeredTool: registeredTool('web_fetch'),
      toolInput: { url: 'not-a-url' },
      permissionMode: 'auto',
    }))).toMatchObject({
      decision: { type: 'requires_approval', safetyAssessment: 'prohibited' },
    });
  });

  it('binds Approval to immutable Tool identity, input, operations, and risk facts', async () => {
    const fixture = createFixture();
    const evaluated = await fixture.permissions.evaluateToolCall(baseRequest());
    if (evaluated.status !== 'ok' || evaluated.decision.type !== 'requires_approval') {
      throw new Error('Approval expected.');
    }
    expect(Object.isFrozen(evaluated.approvalSubject)).toBe(true);
    expect(evaluated.approvalSubject).toMatchObject({
      toolCallId: 'call_1',
      toolIdentity: { sourceId: 'built_in', sourceToolName: 'run_command' },
      criticalInput: { command: 'npm test' },
      riskFacts: { shell: { shellKind: 'powershell', classification: 'verification' } },
    });

    const unchanged = await fixture.permissions.applyApprovalDecision({
      originalPermissionDecision: evaluated.decision,
      originalSubject: evaluated.approvalSubject,
      currentSubject: evaluated.approvalSubject,
      decision: {
        approvalRequestId: 'approval_1', decision: 'approved',
        optionId: evaluated.decision.defaultOptionId,
        decidedBy: 'user', decidedAt: '2026-07-19T00:00:01.000Z',
      },
      sessionId: 'session_1',
      appliedAt: '2026-07-19T00:00:01.000Z',
    });
    expect(unchanged).toEqual({ status: 'applied', effect: { type: 'none' } });

    const changedEvaluation = await fixture.permissions.evaluateToolCall(baseRequest({
      toolInput: { command: 'npm install' },
    }));
    if (changedEvaluation.status !== 'ok') throw new Error('Permission evaluation expected.');
    expect(await fixture.permissions.applyApprovalDecision({
      originalPermissionDecision: evaluated.decision,
      originalSubject: evaluated.approvalSubject,
      currentSubject: changedEvaluation.approvalSubject,
      decision: {
        approvalRequestId: 'approval_1', decision: 'approved',
        optionId: evaluated.decision.defaultOptionId,
        decidedBy: 'user', decidedAt: '2026-07-19T00:00:02.000Z',
      },
      sessionId: 'session_1',
      appliedAt: '2026-07-19T00:00:02.000Z',
    })).toMatchObject({ status: 'rejected', reason: 'subject_changed' });
  });

  it('rejects a forged subject before applying any approval', async () => {
    const fixture = createFixture();
    const evaluated = await fixture.permissions.evaluateToolCall(baseRequest());
    if (evaluated.status !== 'ok' || evaluated.decision.type !== 'requires_approval') {
      throw new Error('Approval expected.');
    }
    const forged = {
      ...evaluated.approvalSubject,
      criticalInput: { command: 'Remove-Item -Recurse .' },
    } as ApprovalSubject;
    expect(await fixture.permissions.applyApprovalDecision({
      originalPermissionDecision: evaluated.decision,
      originalSubject: forged,
      currentSubject: forged,
      decision: {
        approvalRequestId: 'approval_1', decision: 'approved', optionId: evaluated.decision.defaultOptionId,
        decidedBy: 'user', decidedAt: '2026-07-19T00:00:02.000Z',
      },
      sessionId: 'session_1',
      appliedAt: '2026-07-19T00:00:02.000Z',
    })).toMatchObject({ status: 'rejected', reason: 'subject_invalid' });
    expect(fixture.ruleAccess.writes).toHaveLength(0);
  });

  it('offers a resource-scoped Session grant only for an ordinary read_file', async () => {
    const fixture = createFixture();
    fixture.ruleAccess.settings = {
      mode: 'ask', allow: [], deny: [],
      ask: [{ source: 'user', target: { kind: 'operation', action: 'workspace.read', resource: { type: 'workspace.path', matcher: { operator: 'exact', value: 'notes/a.md' } } } }],
    };
    const evaluated = await fixture.permissions.evaluateToolCall(baseRequest({
      registeredTool: registeredTool('read_file'),
      toolInput: { path: 'notes/a.md' },
    }));
    if (evaluated.status !== 'ok' || evaluated.decision.type !== 'requires_approval') {
      throw new Error('Approval expected.');
    }
    const sessionOption = evaluated.decision.options.find((option) => option.scope === 'session');
    const result = await fixture.permissions.applyApprovalDecision({
      originalPermissionDecision: evaluated.decision,
      originalSubject: evaluated.approvalSubject,
      currentSubject: evaluated.approvalSubject,
      decision: {
        approvalRequestId: 'approval_1', decision: 'approved', optionId: sessionOption?.optionId ?? '',
        decidedBy: 'user', decidedAt: '2026-07-19T00:00:02.000Z',
      },
      sessionId: 'session_1',
      appliedAt: '2026-07-19T00:00:02.000Z',
    });
    expect(result).toMatchObject({ status: 'applied', effect: { type: 'session_tool_grant' } });
    expect(fixture.ruleAccess.writes).toEqual([{
      sessionId: 'session_1',
      rules: [{
        source: 'session',
        source_id: 'session_1',
        target: {
          kind: 'operation',
          action: 'workspace.read',
          resource: { type: 'workspace.path', matcher: { operator: 'exact', value: 'notes/a.md' } },
        },
      }],
      appliedAt: '2026-07-19T00:00:02.000Z',
    }]);
  });

  it('never offers a Session grant for commands or mutable file actions', async () => {
    const fixture = createFixture();
    for (const request of [
      baseRequest(),
      baseRequest({ registeredTool: registeredTool('write_file'), toolInput: { path: 'notes/a.md', content: 'x' } }),
      baseRequest({ registeredTool: registeredTool('delete_path'), toolInput: { path: 'notes/a.md' } }),
    ]) {
      const result = await fixture.permissions.evaluateToolCall(request);
      if (result.status !== 'ok' || result.decision.type !== 'requires_approval') throw new Error('Approval expected.');
      expect(result.decision.options.map((option) => option.scope)).toEqual(['once']);
    }
  });
  it('sanitizes dependency failures at the Permissions boundary', async () => {
    const fixture = createFixture();
    fixture.ruleAccess.failure = { code: 'settings_raw_invalid', message: 'raw Settings body' };
    expect(await fixture.permissions.evaluateToolCall(baseRequest())).toEqual({
      status: 'failed',
      failure: {
        code: 'permission_rules_failed',
        message: 'Permission rules could not be resolved.',
        details: { dependencyCode: 'settings_raw_invalid' },
      },
    });
  });
});
