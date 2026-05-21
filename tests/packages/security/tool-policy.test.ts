import { describe, expect, it } from 'vitest';
import {
  evaluatePermissionPolicy,
  evaluateToolPolicy,
  type EvaluatePermissionPolicyInput,
} from '@megumi/security/tool-policy';
import type { JsonObject } from '@megumi/shared/json';
import type { PermissionMode } from '@megumi/shared/permission-mode-contracts';
import type { MergedPermissionSettings } from '@megumi/shared/permission-settings-contracts';
import type {
  PermissionClassifier,
  PermissionClassifierResult,
} from '@megumi/security/permission-classifier';
import type { ToolCall, ToolDefinition } from '@megumi/shared/tool-contracts';

const projectRoot = 'C:/all/work/study/megumi';
const evaluatedAt = '2026-05-20T00:00:00.000Z';

const readDefinition: ToolDefinition = {
  name: 'read_file',
  description: 'Read a normal project file.',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  annotations: { readOnlyHint: true },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
};

const globDefinition: ToolDefinition = {
  name: 'glob',
  description: 'Find project files by pattern.',
  inputSchema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
  annotations: { readOnlyHint: true },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
};

const writeDefinition: ToolDefinition = {
  name: 'write_file',
  description: 'Write a project file.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'],
  },
  annotations: { destructiveHint: true },
  capabilities: ['project_write'],
  riskLevel: 'medium',
  sideEffect: 'project_file_operation',
  availability: { status: 'available' },
};

const commandDefinition: ToolDefinition = {
  name: 'run_command',
  description: 'Run a command in the project.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      cwd: { type: 'string' },
    },
    required: ['command'],
  },
  annotations: { destructiveHint: true },
  capabilities: ['command_run'],
  riskLevel: 'high',
  sideEffect: 'execute_command',
  availability: { status: 'available' },
};

function callFor(definition: ToolDefinition, input: JsonObject): ToolCall {
  const target = String(input.path ?? input.targetPath ?? input.pattern ?? input.cwd ?? input.command ?? '.');

  return {
    toolCallId: 'tool-call-1',
    toolUseId: 'tool-use-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: definition.name,
    input,
    inputPreview: {
      summary: definition.description,
      targets: [{ kind: definition.name === 'run_command' ? 'command' : 'file', label: target, sensitivity: 'normal' }],
      redactionState: 'none',
    },
    capabilities: definition.capabilities,
    riskLevel: definition.riskLevel,
    sideEffect: definition.sideEffect,
    status: 'requested',
    requestedAt: evaluatedAt,
  };
}

function evaluate(input: {
  definition: ToolDefinition;
  toolInput: JsonObject;
  permissionMode: PermissionMode;
  settings?: MergedPermissionSettings;
  classifier?: PermissionClassifier;
}) {
  return evaluatePermissionPolicy({
    definition: input.definition,
    toolCall: callFor(input.definition, input.toolInput),
    permissionMode: input.permissionMode,
    projectRoot,
    settings: input.settings,
    classifier: input.classifier,
    evaluatedAt,
  });
}

describe('evaluatePermissionPolicy', () => {
  it('keeps evaluateToolPolicy compatible with old workspaceRoot inputs', () => {
    const decision = evaluateToolPolicy({
      definition: readDefinition,
      toolCall: callFor(readDefinition, { path: '.megumi/settings.json' }),
      permissionMode: 'default',
      workspaceRoot: projectRoot,
      protectedPathHints: ['.megumi'],
      evaluatedAt,
    });

    expect(decision).toMatchObject({
      decision: 'ask',
      source: 'protected_path',
      target: '.megumi/settings.json',
    });
  });

  it('applies deny rules before allow rules across scopes', () => {
    const decision = evaluate({
      definition: commandDefinition,
      toolInput: { command: 'npm test', cwd: '.' },
      permissionMode: 'default',
      settings: {
        deny: [{ scope: 'project', pattern: 'run_command(npm *)' }],
        allow: [{ scope: 'local', pattern: 'run_command(npm test)' }],
        ask: [],
      },
    });

    expect(decision).toMatchObject({
      decision: 'deny',
      source: 'rule',
      matchedRule: {
        scope: 'project',
        pattern: 'run_command(npm *)',
        decision: 'deny',
      },
      classifierLabel: 'verification',
    });
  });

  it('applies hard guards before ordinary allow rules', () => {
    const decision = evaluate({
      definition: writeDefinition,
      toolInput: { path: '.megumi/settings.json', content: '{}' },
      permissionMode: 'default',
      settings: {
        deny: [],
        allow: [{ scope: 'local', pattern: 'write_file(.megumi/settings.json)' }],
        ask: [],
      },
    });

    expect(decision).toMatchObject({
      decision: 'deny',
      source: 'protected_path',
      target: '.megumi/settings.json',
    });
  });

  it('does not allow run_command references to sensitive paths through ordinary allow rules', () => {
    const decision = evaluate({
      definition: commandDefinition,
      toolInput: { command: 'cat .env', cwd: '.' },
      permissionMode: 'default',
      settings: {
        deny: [],
        allow: [{ scope: 'local', pattern: 'run_command(cat .env)' }],
        ask: [],
      },
    });

    expect(decision).toMatchObject({
      decision: 'ask',
      source: 'sensitive_policy',
      target: '.env',
      classifierLabel: 'secret_or_env',
      requiredApproval: { scope: 'once' },
    });
  });

  it.each(['.mcp.json', '.gitconfig'])(
    'does not allow run_command references to protected default file %s through ordinary allow rules',
    (protectedFile) => {
      const decision = evaluate({
        definition: commandDefinition,
        toolInput: { command: `cat ${protectedFile}`, cwd: '.' },
        permissionMode: 'default',
        settings: {
          deny: [],
          allow: [{ scope: 'local', pattern: `run_command(cat ${protectedFile})` }],
          ask: [],
        },
      });

      expect(decision).toMatchObject({
        decision: 'deny',
        source: 'protected_path',
        target: protectedFile,
      });
    },
  );

  it('does not allow run_command references to protected paths through ordinary allow rules', () => {
    const decision = evaluate({
      definition: commandDefinition,
      toolInput: { command: 'Remove-Item .megumi/settings.json', cwd: '.' },
      permissionMode: 'default',
      settings: {
        deny: [],
        allow: [{ scope: 'local', pattern: 'run_command(Remove-Item .megumi/settings.json)' }],
        ask: [],
      },
    });

    expect(decision).toMatchObject({
      decision: 'deny',
      source: 'protected_path',
      target: '.megumi/settings.json',
      classifierLabel: 'destructive',
    });
  });

  it('asks for project-outside reads before ordinary allow rules', () => {
    const decision = evaluate({
      definition: readDefinition,
      toolInput: { path: '../outside.txt' },
      permissionMode: 'default',
      settings: {
        deny: [],
        allow: [{ scope: 'local', pattern: 'read_file(../outside.txt)' }],
        ask: [],
      },
    });

    expect(decision).toMatchObject({
      decision: 'ask',
      source: 'project_boundary',
      target: '../outside.txt',
      requiredApproval: { scope: 'once' },
    });
  });

  it('classifies glob pattern as a project-bound target before ordinary allow rules', () => {
    const decision = evaluate({
      definition: globDefinition,
      toolInput: { pattern: '../outside/**' },
      permissionMode: 'default',
      settings: {
        deny: [],
        allow: [{ scope: 'local', pattern: 'glob(../outside/**)' }],
        ask: [],
      },
    });

    expect(decision).toMatchObject({
      decision: 'ask',
      source: 'project_boundary',
      target: '../outside/**',
      requiredApproval: { scope: 'once' },
    });
  });

  it('asks for protected path reads before ordinary allow rules', () => {
    const decision = evaluate({
      definition: readDefinition,
      toolInput: { path: '.git/config' },
      permissionMode: 'default',
      settings: {
        deny: [],
        allow: [{ scope: 'local', pattern: 'read_file(.git/config)' }],
        ask: [],
      },
    });

    expect(decision).toMatchObject({
      decision: 'ask',
      source: 'protected_path',
      target: '.git/config',
      requiredApproval: { scope: 'once' },
    });
  });

  it('uses default mode defaults for reads and writes', () => {
    expect(evaluate({
      definition: readDefinition,
      toolInput: { path: 'src/index.ts' },
      permissionMode: 'default',
    })).toMatchObject({
      decision: 'allow',
      source: 'permission_mode',
      requiredSandbox: { level: 'read_only_project', allowedRoots: [projectRoot] },
    });

    expect(evaluate({
      definition: writeDefinition,
      toolInput: { path: 'src/index.ts', content: 'hello' },
      permissionMode: 'default',
    })).toMatchObject({
      decision: 'ask',
      source: 'permission_mode',
      requiredApproval: { scope: 'once' },
      requiredSandbox: { level: 'project_write', allowedRoots: [projectRoot] },
    });
  });

  it('uses plan mode defaults for edits and commands', () => {
    expect(evaluate({
      definition: writeDefinition,
      toolInput: { path: 'src/index.ts', content: 'hello' },
      permissionMode: 'plan',
    })).toMatchObject({
      decision: 'deny',
      source: 'permission_mode',
    });

    expect(evaluate({
      definition: commandDefinition,
      toolInput: { command: 'npm test', cwd: '.' },
      permissionMode: 'plan',
    })).toMatchObject({
      decision: 'ask',
      source: 'permission_mode',
      classifierLabel: 'verification',
      requiredApproval: { scope: 'once' },
    });

    expect(evaluate({
      definition: commandDefinition,
      toolInput: { command: 'unknown-tool --flag', cwd: '.' },
      permissionMode: 'plan',
    })).toMatchObject({
      decision: 'deny',
      source: 'permission_mode',
      classifierLabel: 'unknown',
    });
  });

  it('does not allow definitions with write capability even when sideEffect is none', () => {
    const mismatchedWriteDefinition: ToolDefinition = {
      ...readDefinition,
      name: 'mismatched_write',
      description: 'A mismatched tool definition with write capability and no side effect.',
      capabilities: ['project_write'],
      sideEffect: 'none',
      riskLevel: 'medium',
    };

    const planDecision = evaluate({
      definition: mismatchedWriteDefinition,
      toolInput: { path: 'src/index.ts' },
      permissionMode: 'plan',
    });

    expect(planDecision).toMatchObject({
      decision: 'deny',
      source: 'permission_mode',
    });
    expect(planDecision.requiredApproval).toBeUndefined();

    expect(evaluate({
      definition: mismatchedWriteDefinition,
      toolInput: { path: 'src/index.ts' },
      permissionMode: 'default',
    })).toMatchObject({
      decision: 'ask',
      source: 'permission_mode',
      requiredApproval: { scope: 'once' },
    });
  });

  it('uses accept_edits defaults for ordinary project writes and verification commands', () => {
    expect(evaluate({
      definition: writeDefinition,
      toolInput: { path: 'src/index.ts', content: 'hello' },
      permissionMode: 'accept_edits',
    })).toMatchObject({
      decision: 'allow',
      source: 'permission_mode',
      target: 'src/index.ts',
    });

    expect(evaluate({
      definition: commandDefinition,
      toolInput: { command: 'npx tsc --noEmit', cwd: '.' },
      permissionMode: 'accept_edits',
    })).toMatchObject({
      decision: 'allow',
      source: 'permission_mode',
      classifierLabel: 'verification',
    });
  });

  it('records project root command targets as dot', () => {
    const decision = evaluate({
      definition: commandDefinition,
      toolInput: { command: 'npm test', cwd: '.' },
      permissionMode: 'plan',
    });

    expect(decision).toMatchObject({
      decision: 'ask',
      source: 'permission_mode',
      target: '.',
    });
  });

  it('uses auto classifier after hard guards and mode default defer', () => {
    const classifier: PermissionClassifier = {
      classify: (): PermissionClassifierResult => ({
        decision: 'allow',
        classifierLabel: 'project_file_operation',
        reason: 'Auto classifier allows ordinary project edit.',
        confidence: 0.82,
      }),
    };

    expect(evaluate({
      definition: writeDefinition,
      toolInput: { path: 'src/index.ts', content: 'hello' },
      permissionMode: 'auto',
      classifier,
    })).toMatchObject({
      decision: 'allow',
      source: 'classifier',
      classifierLabel: 'project_file_operation',
      metadata: { confidence: 0.82 },
      target: 'src/index.ts',
    });

    expect(evaluate({
      definition: writeDefinition,
      toolInput: { path: '.env', content: 'TOKEN=value' },
      permissionMode: 'auto',
      classifier,
    })).toMatchObject({
      decision: 'ask',
      source: 'sensitive_policy',
      target: '.env',
      requiredApproval: { scope: 'once' },
    });
  });

  it('uses the target evaluate input contract', () => {
    const input = {
      definition: readDefinition,
      toolCall: callFor(readDefinition, { path: 'README.md' }),
      permissionMode: 'default',
      projectRoot,
      evaluatedAt,
    } satisfies EvaluatePermissionPolicyInput;

    expect(evaluatePermissionPolicy(input).decision).toBe('allow');
  });
});
