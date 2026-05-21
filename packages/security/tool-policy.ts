import type { PermissionMode } from '@megumi/shared/permission-mode-contracts';
import type { MergedPermissionSettings } from '@megumi/shared/permission-settings-contracts';
import type {
  PermissionDecision,
  PermissionDecisionSource,
  PermissionMatchedRule,
  PermissionClassifierLabel,
  SandboxRequirement,
  ToolCall,
  ToolDefinition,
  ToolPolicyDecision,
  ToolPolicyDecisionValue,
  ToolRiskLevel,
} from '@megumi/shared/tool-contracts';
import { classifyCommand, type CommandClassifierLabel } from './command-classifier';
import {
  createRuleBasedPermissionClassifier,
  type PermissionClassifier,
} from './permission-classifier';
import {
  classifyProjectPath,
  type ProjectPathClassification,
} from './project-boundary-policy';
import { matchPermissionRule } from './permission-rule-matcher';

export interface EvaluatePermissionPolicyInput {
  definition: ToolDefinition;
  toolCall: ToolCall;
  permissionMode: PermissionMode;
  projectRoot: string;
  settings?: MergedPermissionSettings;
  classifier?: PermissionClassifier;
  evaluatedAt: string;
}

type EvaluateModeDefaultResult = {
  decision: ToolPolicyDecisionValue;
  reason: string;
};

type HardGuardResult = {
  decision: ToolPolicyDecisionValue;
  source: PermissionDecisionSource;
  reason: string;
};

type RuleBucket = keyof MergedPermissionSettings;

export type EvaluateToolPolicyInput = EvaluatePermissionPolicyInput;

export function evaluatePermissionPolicy(input: EvaluatePermissionPolicyInput): PermissionDecision {
  const commandClassification = classifyToolCommand(input);
  const projectPath = classifyToolTargetPath(input);

  const denyRule = findMatchedRule(input, 'deny');
  if (denyRule) {
    return createPermissionDecision(input, 'deny', 'rule', `Denied by ${denyRule.scope} permission rule.`, {
      matchedRule: { ...denyRule, decision: 'deny' },
      commandLabel: commandClassification?.label,
      projectPath,
    });
  }

  const hardGuard = evaluateHardGuards(input, projectPath);
  if (hardGuard) {
    return createPermissionDecision(input, hardGuard.decision, hardGuard.source, hardGuard.reason, {
      commandLabel: commandClassification?.label,
      projectPath,
    });
  }

  const allowRule = findMatchedRule(input, 'allow');
  if (allowRule) {
    return createPermissionDecision(input, 'allow', 'rule', `Allowed by ${allowRule.scope} permission rule.`, {
      matchedRule: { ...allowRule, decision: 'allow' },
      commandLabel: commandClassification?.label,
      projectPath,
    });
  }

  const askRule = findMatchedRule(input, 'ask');
  if (askRule) {
    return createPermissionDecision(input, 'ask', 'rule', `Asked by ${askRule.scope} permission rule.`, {
      matchedRule: { ...askRule, decision: 'ask' },
      commandLabel: commandClassification?.label,
      projectPath,
    });
  }

  const modeDefault = evaluatePermissionModeDefault(input, commandClassification?.label, projectPath);
  if (modeDefault) {
    return createPermissionDecision(input, modeDefault.decision, 'permission_mode', modeDefault.reason, {
      commandLabel: commandClassification?.label,
      projectPath,
    });
  }

  if (input.permissionMode === 'auto') {
    const classifier = input.classifier ?? createRuleBasedPermissionClassifier();
    const classified = classifier.classify({
      permissionMode: input.permissionMode,
      toolName: input.definition.name,
      capability: input.definition.capabilities[0],
      sideEffect: input.definition.sideEffect,
      commandLabel: commandClassification?.label,
      projectPath: projectPath
        ? {
            insideProject: projectPath.insideProject,
            protected: projectPath.protected,
            sensitive: projectPath.sensitive,
          }
        : undefined,
    });

    return createPermissionDecision(input, classified.decision, 'classifier', classified.reason, {
      classifierLabel: classified.classifierLabel,
      projectPath,
      confidence: classified.confidence,
    });
  }

  return createPermissionDecision(input, 'ask', 'permission_mode', 'Fallback asks for user approval.', {
    commandLabel: commandClassification?.label,
    projectPath,
  });
}

export const evaluateToolPolicy = evaluatePermissionPolicy;

function classifyToolCommand(input: EvaluatePermissionPolicyInput) {
  if (input.definition.name !== 'run_command' || !isRecord(input.toolCall.input)) {
    return undefined;
  }

  const command = input.toolCall.input.command;
  return classifyCommand(typeof command === 'string' ? command : '');
}

function classifyToolTargetPath(input: EvaluatePermissionPolicyInput): ProjectPathClassification | undefined {
  if (!isRecord(input.toolCall.input)) {
    return undefined;
  }

  if (input.definition.name === 'run_command') {
    const cwd = input.toolCall.input.cwd;
    return classifyProjectPath({
      projectRoot: input.projectRoot,
      targetPath: typeof cwd === 'string' ? cwd : '.',
    });
  }

  const targetPath = input.toolCall.input.path
    ?? input.toolCall.input.targetPath
    ?? input.toolCall.input.pattern;
  if (typeof targetPath !== 'string') {
    return undefined;
  }

  return classifyProjectPath({ projectRoot: input.projectRoot, targetPath });
}

function findMatchedRule(
  input: EvaluatePermissionPolicyInput,
  bucket: RuleBucket,
): Omit<PermissionMatchedRule, 'decision'> | undefined {
  return (input.settings?.[bucket] ?? []).find((rule) =>
    matchPermissionRule(rule.pattern, {
      toolName: input.definition.name,
      input: input.toolCall.input,
    }).matched,
  );
}

function evaluateHardGuards(
  input: EvaluatePermissionPolicyInput,
  projectPath: ProjectPathClassification | undefined,
): HardGuardResult | undefined {
  const readsProject = isProjectRead(input.definition);
  const writesProject = isProjectWrite(input.definition);

  if (projectPath && !projectPath.insideProject) {
    if (readsProject && input.definition.sideEffect === 'none') {
      return {
        decision: 'ask',
        source: 'project_boundary',
        reason: 'Project boundary requires approval before reading outside the project.',
      };
    }

    return {
      decision: 'deny',
      source: 'project_boundary',
      reason: 'Project boundary blocks writes, commands, and side effects outside the project.',
    };
  }

  if (projectPath?.protected) {
    if (writesProject || input.definition.capabilities.includes('command_run')) {
      return {
        decision: 'deny',
        source: 'protected_path',
        reason: 'Protected path blocks ordinary project writes and commands.',
      };
    }

    return {
      decision: 'ask',
      source: 'protected_path',
      reason: 'Protected path reads require explicit user confirmation.',
    };
  }

  if (projectPath?.sensitive) {
    return {
      decision: 'ask',
      source: 'sensitive_policy',
      reason: 'Sensitive path requires explicit user confirmation.',
    };
  }

  return undefined;
}

function evaluatePermissionModeDefault(
  input: EvaluatePermissionPolicyInput,
  commandLabel: CommandClassifierLabel | undefined,
  projectPath: ProjectPathClassification | undefined,
): EvaluateModeDefaultResult | undefined {
  const readsProject = isProjectRead(input.definition);
  const writesProject = isProjectWrite(input.definition);

  if (input.permissionMode === 'default') {
    if (readsProject) {
      return { decision: 'allow', reason: 'default allows project reads.' };
    }

    return { decision: 'ask', reason: 'default asks before writes or commands.' };
  }

  if (input.permissionMode === 'accept_edits') {
    if (readsProject) {
      return { decision: 'allow', reason: 'accept_edits allows project reads.' };
    }

    if (writesProject && projectPath?.insideProject && !projectPath.protected && !projectPath.sensitive) {
      return { decision: 'allow', reason: 'accept_edits allows ordinary project edits.' };
    }

    if (isAllowedCommandInAcceptEdits(commandLabel)) {
      return { decision: 'allow', reason: `accept_edits allows ${commandLabel} commands.` };
    }

    if (commandLabel === 'destructive' || commandLabel === 'unknown') {
      return { decision: 'deny', reason: 'accept_edits denies destructive and unknown commands.' };
    }

    return { decision: 'ask', reason: 'accept_edits asks before risky commands.' };
  }

  if (input.permissionMode === 'plan') {
    if (readsProject) {
      return { decision: 'allow', reason: 'plan allows read-only tools.' };
    }

    if (isAllowedCommandInPlan(commandLabel)) {
      return { decision: 'allow', reason: `plan allows ${commandLabel} commands.` };
    }

    if (commandLabel === 'verification') {
      return { decision: 'ask', reason: 'plan asks before verification commands.' };
    }

    return { decision: 'deny', reason: 'plan denies writes, mutations, destructive commands, and unknown commands.' };
  }

  return undefined;
}

function createPermissionDecision(
  input: EvaluatePermissionPolicyInput,
  decision: ToolPolicyDecisionValue,
  source: PermissionDecisionSource,
  reason: string,
  options: {
    matchedRule?: PermissionMatchedRule;
    commandLabel?: CommandClassifierLabel;
    classifierLabel?: PermissionClassifierLabel;
    projectPath?: ProjectPathClassification;
    confidence?: number;
  } = {},
): PermissionDecision {
  return {
    permissionDecisionId: `permission-decision:${input.toolCall.toolCallId}`,
    toolUseId: input.toolCall.toolUseId,
    toolCallId: input.toolCall.toolCallId,
    runId: input.toolCall.runId,
    decision,
    source,
    reason,
    mode: input.permissionMode,
    ...(options.matchedRule ? { matchedRule: options.matchedRule } : {}),
    ...classifierLabelFields(options),
    ...targetField(options.projectPath),
    capability: input.definition.capabilities[0],
    sideEffect: input.definition.sideEffect,
    effectiveRiskLevel: decision === 'deny'
      ? escalateRisk(input.definition.riskLevel, 'high')
      : input.definition.riskLevel,
    ...(decision === 'ask' ? { requiredApproval: { scope: 'once', reason } } : {}),
    requiredSandbox: createSandboxRequirement(input),
    evaluatedAt: input.evaluatedAt,
    ...(typeof options.confidence === 'number' ? { metadata: { confidence: options.confidence } } : {}),
  };
}

function classifierLabelFields(options: {
  commandLabel?: CommandClassifierLabel;
  classifierLabel?: PermissionClassifierLabel;
}): Pick<PermissionDecision, 'classifierLabel'> | Record<string, never> {
  const classifierLabel = options.classifierLabel ?? options.commandLabel;
  return classifierLabel ? { classifierLabel } : {};
}

function targetField(
  projectPath: ProjectPathClassification | undefined,
): Pick<PermissionDecision, 'target'> | Record<string, never> {
  if (!projectPath) {
    return {};
  }

  return { target: projectPath.relativePath || '.' };
}

function createSandboxRequirement(input: EvaluatePermissionPolicyInput): SandboxRequirement {
  return {
    level: sandboxLevelForDefinition(input.definition),
    allowedRoots: [input.projectRoot],
    networkPolicy: 'deny',
  };
}

function sandboxLevelForDefinition(definition: ToolDefinition): SandboxRequirement['level'] {
  if (definition.capabilities.includes('command_run')) {
    return 'restricted_command';
  }
  if (definition.capabilities.includes('network_access') || definition.capabilities.includes('browser_access')) {
    return 'network_restricted';
  }
  if (definition.capabilities.includes('project_write')) {
    return 'project_write';
  }
  if (definition.capabilities.includes('project_read')) {
    return 'read_only_project';
  }
  return 'host_restricted';
}

function isProjectRead(definition: ToolDefinition): boolean {
  return definition.sideEffect === 'none' || definition.capabilities.includes('project_read');
}

function isProjectWrite(definition: ToolDefinition): boolean {
  return definition.capabilities.includes('project_write')
    || definition.sideEffect === 'project_file_operation';
}

function isAllowedCommandInAcceptEdits(
  commandLabel: CommandClassifierLabel | undefined,
): commandLabel is 'read_only' | 'search_or_list' | 'git_read' | 'verification' {
  return commandLabel === 'read_only'
    || commandLabel === 'search_or_list'
    || commandLabel === 'git_read'
    || commandLabel === 'verification';
}

function isAllowedCommandInPlan(
  commandLabel: CommandClassifierLabel | undefined,
): commandLabel is 'read_only' | 'search_or_list' | 'git_read' {
  return commandLabel === 'read_only'
    || commandLabel === 'search_or_list'
    || commandLabel === 'git_read';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function escalateRisk(current: ToolRiskLevel, minimum: ToolRiskLevel): ToolRiskLevel {
  const order: ToolRiskLevel[] = ['low', 'medium', 'high', 'critical'];
  return order.indexOf(current) >= order.indexOf(minimum) ? current : minimum;
}

export type { ToolPolicyDecision };
