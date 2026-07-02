import { describe, expect, it } from 'vitest';
import {
  evaluatePermissionPolicy,
  evaluateToolPolicy,
  type EvaluatePermissionPolicyInput,
} from '@megumi/coding-agent/permissions/tool-policy';
import type { JsonObject } from '@megumi/shared/primitives';
import type { PermissionMode } from '@megumi/shared/permission';
import type { MergedPermissionSettings } from '@megumi/shared/permission';
import type {
  PermissionClassifier,
  PermissionClassifierResult,
} from '@megumi/coding-agent/permissions/permission-classifier';
import type { ToolDefinition } from '@megumi/coding-agent/tools';
import type { ToolExecution } from '@megumi/shared/tool';

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

function callFor(definition: ToolDefinition, input: JsonObject): ToolExecution {
  const target = String(input.path ?? input.targetPath ?? input.pattern ?? input.cwd ?? input.command ?? '.');

  return {
    toolExecutionId: 'tool-execution-1',
    toolCallId: 'tool-call-1',
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
    status: 'running',
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
    toolExecution: callFor(input.definition, input.toolInput),
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
      toolExecution: callFor(readDefinition, { path: '.megumi/settings.json' }),
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

  it.each(['plan', 'accept_edits'] as const)(
    'blocks run_command cat project boundary escapes in %s mode before allow-ish policy defaults',
    (permissionMode) => {
      const decision = evaluate({
        definition: commandDefinition,
        toolInput: { command: 'cat ../outside.txt', cwd: '.' },
        permissionMode,
        settings: {
          deny: [],
          allow: [{ scope: 'local', pattern: 'run_command(cat ../outside.txt)' }],
          ask: [],
        },
      });

      expect(decision).toMatchObject({
        decision: 'deny',
        source: 'project_boundary',
        target: '../outside.txt',
        classifierLabel: 'read_only',
      });
    },
  );

  it('blocks run_command cat option path project boundary escapes before ordinary allow rules', () => {
    const decision = evaluate({
      definition: commandDefinition,
      toolInput: { command: 'cat --path=../outside.txt', cwd: '.' },
      permissionMode: 'default',
      settings: {
        deny: [],
        allow: [{ scope: 'local', pattern: 'run_command(cat --path=../outside.txt)' }],
        ask: [],
      },
    });

    expect(decision).toMatchObject({
      decision: 'deny',
      source: 'project_boundary',
      target: '../outside.txt',
    });
  });

  it('blocks run_command redirection-prefixed project boundary escapes before ordinary allow rules', () => {
    const decision = evaluate({
      definition: commandDefinition,
      toolInput: { command: 'echo hi >..\\outside.txt', cwd: '.' },
      permissionMode: 'default',
      settings: {
        deny: [],
        allow: [{ scope: 'local', pattern: 'run_command(echo hi >..\\outside.txt)' }],
        ask: [],
      },
    });

    expect(decision).toMatchObject({
      decision: 'deny',
      source: 'project_boundary',
      target: '../outside.txt',
    });
  });

  it('blocks run_command file-descriptor redirection project boundary escapes before ordinary allow rules', () => {
    const decision = evaluate({
      definition: commandDefinition,
      toolInput: { command: 'echo hi 2>..\\outside.txt', cwd: '.' },
      permissionMode: 'default',
      settings: {
        deny: [],
        allow: [{ scope: 'local', pattern: 'run_command(echo hi 2>..\\outside.txt)' }],
        ask: [],
      },
    });

    expect(decision).toMatchObject({
      decision: 'deny',
      source: 'project_boundary',
      target: '../outside.txt',
    });
  });

  it('blocks run_command all-stream redirection project boundary escapes before ordinary allow rules', () => {
    const decision = evaluate({
      definition: commandDefinition,
      toolInput: { command: 'echo hi *>..\\outside.txt', cwd: '.' },
      permissionMode: 'default',
      settings: {
        deny: [],
        allow: [{ scope: 'local', pattern: 'run_command(echo hi *>..\\outside.txt)' }],
        ask: [],
      },
    });

    expect(decision).toMatchObject({
      decision: 'deny',
      source: 'project_boundary',
      target: '../outside.txt',
    });
  });

  it('blocks run_command at-prefixed project boundary escapes before ordinary allow rules', () => {
    const decision = evaluate({
      definition: commandDefinition,
      toolInput: { command: 'cat @../outside.txt', cwd: '.' },
      permissionMode: 'default',
      settings: {
        deny: [],
        allow: [{ scope: 'local', pattern: 'run_command(cat @../outside.txt)' }],
        ask: [],
      },
    });

    expect(decision).toMatchObject({
      decision: 'deny',
      source: 'project_boundary',
      target: '../outside.txt',
    });
  });

  it('blocks run_command type project boundary escapes before allow-ish policy defaults', () => {
    const decision = evaluate({
      definition: commandDefinition,
      toolInput: { command: 'type ..\\outside.txt', cwd: '.' },
      permissionMode: 'accept_edits',
      settings: {
        deny: [],
        allow: [{ scope: 'local', pattern: 'run_command(type ..\\outside.txt)' }],
        ask: [],
      },
    });

    expect(decision).toMatchObject({
      decision: 'deny',
      source: 'project_boundary',
      target: '../outside.txt',
      classifierLabel: 'read_only',
    });
  });

  it('blocks run_command rg project boundary escapes before allow-ish policy defaults', () => {
    const decision = evaluate({
      definition: commandDefinition,
      toolInput: { command: 'rg token ../outside', cwd: '.' },
      permissionMode: 'plan',
      settings: {
        deny: [],
        allow: [{ scope: 'local', pattern: 'run_command(rg token ../outside)' }],
        ask: [],
      },
    });

    expect(decision).toMatchObject({
      decision: 'deny',
      source: 'project_boundary',
      target: '../outside',
    });
  });

  it('keeps ordinary project-local run_command file reads on normal command policy', () => {
    const decision = evaluate({
      definition: commandDefinition,
      toolInput: { command: 'cat README.md', cwd: '.' },
      permissionMode: 'plan',
    });

    expect(decision).toMatchObject({
      decision: 'allow',
      source: 'permission_mode',
      target: 'README.md',
      classifierLabel: 'read_only',
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
      toolExecution: callFor(readDefinition, { path: 'README.md' }),
      permissionMode: 'default',
      projectRoot,
      evaluatedAt,
    } satisfies EvaluatePermissionPolicyInput;

    expect(evaluatePermissionPolicy(input).decision).toBe('allow');
  });

  it('copies source identity from tool execution into permission decisions', () => {
    const decision = evaluatePermissionPolicy({
      definition: readDefinition,
      toolExecution: {
        ...callFor(readDefinition, { path: 'README.md' }),
        registrySnapshotId: 'tool-registry-snapshot-run-1',
        snapshotEntryId: 'tool-registry-snapshot-entry-run-1-tool-registration-built_in-read_file-built_in-megumi-read_file',
        modelVisibleName: 'read_file',
        canonicalToolId: 'built_in:megumi:read_file',
        sourceId: 'built_in',
        namespace: 'megumi',
        sourceToolName: 'read_file',
      },
      permissionMode: 'default',
      projectRoot,
      evaluatedAt,
    });

    expect(decision).toMatchObject({
      registrySnapshotId: 'tool-registry-snapshot-run-1',
      snapshotEntryId: 'tool-registry-snapshot-entry-run-1-tool-registration-built_in-read_file-built_in-megumi-read_file',
      modelVisibleName: 'read_file',
      canonicalToolId: 'built_in:megumi:read_file',
      sourceId: 'built_in',
      namespace: 'megumi',
      sourceToolName: 'read_file',
    });
  });

  it('matches permission rules against model visible tool names', () => {
    const demoDefinition: ToolDefinition = {
      name: 'demo_echo',
      description: 'Echo through the external demo source.',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
      capabilities: ['external_app'],
      riskLevel: 'low',
      sideEffect: 'read_external',
      availability: { status: 'available' },
    };
    const toolExecution: ToolExecution = {
      ...callFor(demoDefinition, { message: 'hello' }),
      registrySnapshotId: 'tool-registry-snapshot-run-1',
      snapshotEntryId: 'tool-registry-snapshot-entry-run-1-tool-registration-external_test-echo-external_test-demo-echo',
      modelVisibleName: 'demo_echo',
      canonicalToolId: 'external_test:demo:echo',
      sourceId: 'external_test',
      namespace: 'demo',
      sourceToolName: 'echo',
    };

    expect(evaluatePermissionPolicy({
      definition: demoDefinition,
      toolExecution,
      permissionMode: 'default',
      projectRoot,
      settings: {
        allow: [{ scope: 'project', pattern: 'demo_echo' }],
        ask: [],
        deny: [],
      },
      evaluatedAt,
    })).toMatchObject({
      decision: 'allow',
      matchedRule: { pattern: 'demo_echo' },
    });

    expect(evaluatePermissionPolicy({
      definition: demoDefinition,
      toolExecution,
      permissionMode: 'default',
      projectRoot,
      settings: {
        allow: [{ scope: 'project', pattern: 'external_test:demo:echo' }],
        ask: [],
        deny: [],
      },
      evaluatedAt,
    })).toMatchObject({
      decision: 'ask',
      source: 'permission_mode',
    });
  });
});

