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
} from '../../../packages/agent/permissions/src/index';
import type { ToolShellKind } from '../../../packages/agent/tools/src/index';

class FakeRuleAccess implements PermissionRuleReader, PermissionRuleWriter {
  readonly writes: unknown[] = [];
  settings: PermissionSettings = { mode: 'ask', allow: [], ask: [], deny: [] };
  failure?: { code: string; message: string };

  resolvePermissionRules() {
    return this.failure
      ? { status: 'failed' as const, failure: this.failure }
      : { status: 'resolved' as const, permissionSettings: this.settings };
  }

  async recordSessionPermissionGrant(request: unknown) {
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

interface TestToolFact {
  readonly identity: { readonly sourceId: string; readonly namespace: string; readonly sourceToolName: string };
  readonly registeredToolName: string;
  readonly shellKind: ToolShellKind | 'unknown';
}

function registeredTool(name: string, shellKind: ToolShellKind | 'unknown' = 'powershell'): TestToolFact {
  return {
    identity: { sourceId: 'built_in', namespace: 'megumi', sourceToolName: name },
    registeredToolName: name,
    shellKind,
  };
}

function externalTool(): TestToolFact {
  return {
    identity: { sourceId: 'mcp:calendar', namespace: 'calendar', sourceToolName: 'create_event' },
    registeredToolName: 'calendar_create_event',
    shellKind: 'unknown',
  };
}

function baseRequest(overrides: Partial<EvaluateToolCallRequest> & { registeredTool?: TestToolFact } = {}): EvaluateToolCallRequest {
  const { registeredTool: tool = registeredTool('run_command'), ...values } = overrides;
  const toolInput = values.toolInput ?? { command: 'npm test' };
  return {
    executionId: 'run_1',
    sessionId: 'session_1',
    workspaceId: 'workspace_1',
    toolCallId: 'call_1',
    toolInput,
    operations: operationsFor(tool, toolInput),
    permissionMode: 'ask',
    evaluatedAt: '2026-07-19T00:00:00.000Z',
    ...values,
  };
}

function operationsFor(tool: TestToolFact, input: unknown): EvaluateToolCallRequest['operations'] {
  const record = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const context = {
    workspaceId: 'workspace_1', sessionId: 'session_1', executionId: 'run_1',
    toolIdentity: { ...tool.identity, registeredToolName: tool.registeredToolName },
  };
  const path = (key: string, fallback = '.') => typeof record[key] === 'string' ? String(record[key]) : fallback;
  if (tool.identity.sourceId !== 'built_in') return [{
    action: 'external.invoke', resource: { type: 'tool.identity', id: tool.registeredToolName }, context,
  }];
  if (tool.registeredToolName === 'run_command') return [{
    action: 'process.execute',
    resource: { type: 'process.command', id: path('command', ''), attributes: { shellKind: tool.shellKind } },
    context,
  }];
  if (tool.registeredToolName === 'copy_path' || tool.registeredToolName === 'move_path') return [
    { action: tool.registeredToolName === 'copy_path' ? 'workspace.read' : 'workspace.write', resource: { type: 'workspace.path', id: path('source', '') }, context },
    { action: 'workspace.write', resource: { type: 'workspace.path', id: path('destination', '') }, context },
  ];
  if (['write_file', 'edit_file', 'delete_path', 'create_directory'].includes(tool.registeredToolName)) return [{
    action: 'workspace.write', resource: { type: 'workspace.path', id: path('path', '') }, context,
  }];
  if (['read_file', 'list_directory', 'glob', 'search_text'].includes(tool.registeredToolName)) return [{
    action: 'workspace.read', resource: { type: 'workspace.path', id: path(tool.registeredToolName === 'glob' ? 'cwd' : 'path') }, context,
  }];
  if (tool.registeredToolName === 'web_fetch') return [{
    action: 'network.fetch', resource: { type: 'network.url', id: path('url', '') }, context,
  }];
  return [{ action: 'agent.context.activate', context }];
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

  it('returns the execution access selected by the permission mode and risk', async () => {
    const fixture = createFixture();
    const restricted = await fixture.permissions.evaluateToolCall(baseRequest({
      registeredTool: registeredTool('read_file'),
      toolInput: { path: 'notes/a.md' },
      permissionMode: 'auto',
    }));
    expect(restricted).toMatchObject({
      status: 'ok',
      decision: { type: 'allow' },
      executionAccess: {
        fileSystem: { mode: 'workspace' },
        process: 'sandboxed',
        network: 'denied',
      },
    });

    const unrestricted = await fixture.permissions.evaluateToolCall(baseRequest({
      registeredTool: registeredTool('write_file'),
      toolInput: { path: '../outside/a.ts', content: 'x' },
      permissionMode: 'full_access',
    }));
    expect(unrestricted).toMatchObject({
      status: 'ok',
      decision: { type: 'allow' },
      executionAccess: {
        fileSystem: { mode: 'unrestricted' },
        process: 'unrestricted',
        network: 'unrestricted',
      },
    });
  });
  it('treats Skill file reads as ordinary external reads without any elevation', async () => {
    const fixture = createFixture();
    // An explicit allow rule keeps the decision inside ordinary Permissions rules.
    fixture.ruleAccess.settings = {
      mode: 'auto',
      allow: [{
        source: 'user',
        target: {
          kind: 'operation',
          action: 'workspace.read',
          resource: { type: 'workspace.path', matcher: { operator: 'exact', value: 'C:/skills/review/SKILL.md' } },
        },
      }],
      ask: [],
      deny: [],
    };
    const evaluated = await fixture.permissions.evaluateToolCall(baseRequest({
      registeredTool: registeredTool('read_file'),
      toolInput: { path: '../skills/review/SKILL.md' },
      permissionMode: 'auto',
    }));
    expect(evaluated).toMatchObject({
      status: 'ok',
      decision: { type: 'allow' },
      operations: [expect.objectContaining({ action: 'workspace.read' })],
    });
    if (evaluated.status !== 'ok') return;
    // The operation is a plain workspace.read: no Skill markers reach Permissions.
    expect(JSON.stringify(evaluated.operations)).not.toContain('skillPackageRoot');
    expect(evaluated.operations[0]?.resource?.attributes).not.toHaveProperty('skillPackageRoot');
    // The grant covers exactly the requested external target, never a package directory.
    expect(evaluated.executionAccess).toEqual({
      fileSystem: {
        mode: 'workspace_and_paths',
        readablePaths: ['C:/skills/review/SKILL.md'],
        writablePaths: [],
      },
      process: 'sandboxed',
      network: 'denied',
    });
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

  it('grants only the canonical external path after a file action is approved', async () => {
    const fixture = createFixture();
    const evaluated = await fixture.permissions.evaluateToolCall(baseRequest({
      registeredTool: registeredTool('write_file'),
      toolInput: { path: '../outside/a.ts', content: 'x' },
      permissionMode: 'ask',
    }));
    if (evaluated.status !== 'ok' || evaluated.decision.type !== 'requires_approval') {
      throw new Error('Approval expected.');
    }

    const applied = await fixture.permissions.applyApprovalDecision({
      originalPermissionDecision: evaluated.decision,
      originalSubject: evaluated.approvalSubject,
      currentSubject: evaluated.approvalSubject,
      decision: {
        approvalRequestId: 'approval_1',
        decision: 'approved',
        optionId: evaluated.decision.defaultOptionId,
        decidedBy: 'user',
        decidedAt: '2026-07-19T00:00:01.000Z',
      },
      sessionId: 'session_1',
      appliedAt: '2026-07-19T00:00:01.000Z',
      permissionMode: 'ask',
    });

    expect(applied).toMatchObject({
      status: 'applied',
      executionAccess: {
        fileSystem: {
          mode: 'workspace_and_paths',
          readablePaths: [],
          writablePaths: ['C:/outside/a.ts'],
        },
        process: 'sandboxed',
        network: 'denied',
      },
    });
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
      permissionMode: 'ask',
    });
    expect(unchanged).toEqual({
      status: 'applied',
      effect: { type: 'none' },
      executionAccess: {
        fileSystem: { mode: 'unrestricted' },
        process: 'unrestricted',
        network: 'unrestricted',
      },
    });

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
      permissionMode: 'ask',
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
      permissionMode: 'ask',
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
      permissionMode: 'ask',
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
