import type { SandboxRequirement, ToolCall, ToolDefinition, ToolPolicyDecision, ToolRiskLevel } from '@megumi/shared/tool-contracts';
import type { PermissionMode } from '@megumi/shared/permission-mode-contracts';

export interface EvaluateToolPolicyInput {
  definition: ToolDefinition;
  toolCall: ToolCall;
  permissionMode: PermissionMode;
  workspaceRoot?: string;
  protectedPathHints?: string[];
  evaluatedAt: string;
}

export function evaluateToolPolicy(input: EvaluateToolPolicyInput): ToolPolicyDecision {
  const targetLabels = input.toolCall.inputPreview.targets.map((target) => target.label);
  const touchesProtectedPath = targetLabels.some((label) =>
    input.protectedPathHints?.some((hint) => label.includes(hint)),
  );
  const touchesSecret = input.toolCall.inputPreview.targets.some((target) => target.sensitivity === 'secret');

  if (touchesProtectedPath || touchesSecret || input.definition.capabilities.includes('secret_read')) {
    return createPolicyDecision(input, {
      decision: 'deny',
      source: 'system_default',
      reason: 'Tool call targets protected or secret content.',
      effectiveRiskLevel: 'critical',
      requiredSandbox: createSandboxRequirement(input, 'host_restricted'),
    });
  }

  if (input.permissionMode === 'plan' && hasSideEffect(input.definition)) {
    return createPolicyDecision(input, {
      decision: 'deny',
      source: 'permission_mode',
      reason: 'plan permissionMode blocks side-effecting tool calls.',
      effectiveRiskLevel: escalateRisk(input.definition.riskLevel, 'high'),
      requiredSandbox: createSandboxRequirement(input, sandboxLevelForDefinition(input.definition)),
    });
  }

  if (requiresApproval(input.definition)) {
    return createPolicyDecision(input, {
      decision: 'ask',
      source: 'system_default',
      reason: 'Tool call requires user approval.',
      effectiveRiskLevel: input.definition.riskLevel,
      requiredApproval: {
        scope: 'once',
        reason: 'User approval is required for this tool capability.',
      },
      requiredSandbox: createSandboxRequirement(input, sandboxLevelForDefinition(input.definition)),
    });
  }

  return createPolicyDecision(input, {
    decision: 'allow',
    source: 'system_default',
    reason: 'Read-only low-risk tool call is allowed.',
    effectiveRiskLevel: input.definition.riskLevel,
    requiredSandbox: createSandboxRequirement(input, sandboxLevelForDefinition(input.definition)),
  });
}

function hasSideEffect(definition: ToolDefinition): boolean {
  return definition.sideEffect !== 'none' && definition.sideEffect !== 'read_external';
}

function requiresApproval(definition: ToolDefinition): boolean {
  return definition.riskLevel === 'medium'
    || definition.riskLevel === 'high'
    || definition.riskLevel === 'critical'
    || hasSideEffect(definition)
    || definition.capabilities.some((capability) => capability !== 'project_read');
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

function createPolicyDecision(
  input: EvaluateToolPolicyInput,
  decision: Pick<ToolPolicyDecision, 'decision' | 'source' | 'reason' | 'effectiveRiskLevel'>
    & Partial<Pick<ToolPolicyDecision, 'requiredApproval' | 'requiredSandbox'>>,
): ToolPolicyDecision {
  return {
    permissionDecisionId: `${input.toolCall.toolCallId}:policy`,
    toolUseId: input.toolCall.toolUseId,
    toolCallId: input.toolCall.toolCallId,
    runId: input.toolCall.runId,
    mode: input.permissionMode,
    capability: input.definition.capabilities[0],
    sideEffect: input.definition.sideEffect,
    evaluatedAt: input.evaluatedAt,
    ...decision,
  };
}

function createSandboxRequirement(
  input: EvaluateToolPolicyInput,
  level: SandboxRequirement['level'],
): SandboxRequirement {
  return {
    level,
    ...(input.workspaceRoot ? { allowedRoots: [input.workspaceRoot] } : {}),
    ...(input.protectedPathHints ? { protectedPaths: input.protectedPathHints } : {}),
    networkPolicy: level === 'network_restricted' ? 'restricted' : 'deny',
  };
}

function escalateRisk(current: ToolRiskLevel, minimum: ToolRiskLevel): ToolRiskLevel {
  const order: ToolRiskLevel[] = ['low', 'medium', 'high', 'critical'];
  return order.indexOf(current) >= order.indexOf(minimum) ? current : minimum;
}
