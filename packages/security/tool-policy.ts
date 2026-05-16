import type {
  SandboxRequirement,
  ToolCall,
  ToolDefinition,
  ToolPolicyDecision,
  ToolRiskLevel,
} from '@megumi/shared/tool-contracts';

export interface EvaluateToolPolicyInput {
  definition: ToolDefinition;
  toolCall: ToolCall;
  permissionMode: string;
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
    return {
      decision: 'deny',
      reason: 'Tool call targets protected or secret content.',
      effectiveRiskLevel: 'critical',
      requiredSandbox: createSandboxRequirement(input, 'host_restricted'),
      evaluatedAt: input.evaluatedAt,
    };
  }

  if (input.permissionMode === 'plan' && hasSideEffect(input.definition)) {
    return {
      decision: 'deny',
      reason: 'plan permissionMode blocks side-effecting tool calls.',
      effectiveRiskLevel: escalateRisk(input.definition.riskLevel, 'high'),
      requiredSandbox: createSandboxRequirement(input, sandboxLevelForDefinition(input.definition)),
      evaluatedAt: input.evaluatedAt,
    };
  }

  if (requiresApproval(input.definition)) {
    return {
      decision: 'ask',
      reason: 'Tool call requires user approval.',
      effectiveRiskLevel: input.definition.riskLevel,
      requiredApproval: {
        scope: 'once',
        reason: 'User approval is required for this tool capability.',
      },
      requiredSandbox: createSandboxRequirement(input, sandboxLevelForDefinition(input.definition)),
      evaluatedAt: input.evaluatedAt,
    };
  }

  return {
    decision: 'allow',
    reason: 'Read-only low-risk tool call is allowed.',
    effectiveRiskLevel: input.definition.riskLevel,
    requiredSandbox: createSandboxRequirement(input, sandboxLevelForDefinition(input.definition)),
    evaluatedAt: input.evaluatedAt,
  };
}

function hasSideEffect(definition: ToolDefinition): boolean {
  return definition.sideEffect !== 'none' && definition.sideEffect !== 'read_external';
}

function requiresApproval(definition: ToolDefinition): boolean {
  return definition.riskLevel === 'medium'
    || definition.riskLevel === 'high'
    || definition.riskLevel === 'critical'
    || hasSideEffect(definition)
    || definition.capabilities.some((capability) => capability !== 'workspace_read');
}

function sandboxLevelForDefinition(definition: ToolDefinition): SandboxRequirement['level'] {
  if (definition.capabilities.includes('command_run')) {
    return 'restricted_command';
  }
  if (definition.capabilities.includes('network_access') || definition.capabilities.includes('browser_access')) {
    return 'network_restricted';
  }
  if (definition.capabilities.includes('workspace_write')) {
    return 'workspace_write';
  }
  if (definition.capabilities.includes('workspace_read')) {
    return 'read_only_workspace';
  }
  return 'host_restricted';
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
