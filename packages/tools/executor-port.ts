import type {
  SandboxRequirement,
  ToolCall,
  ToolDefinition,
  ToolError,
  ToolPolicyDecision,
  ToolResult,
} from '@megumi/shared/tool-contracts';
import type { RuntimeContext } from '@megumi/shared/runtime-context';

export interface HostToolExecutionInput {
  toolCall: ToolCall;
  definition: ToolDefinition;
  validatedInput: unknown;
  policyDecision: ToolPolicyDecision;
  sandboxRequirement?: SandboxRequirement;
  runtimeContext?: RuntimeContext;
}

export interface HostToolExecutor {
  execute(input: HostToolExecutionInput): Promise<ToolResult | ToolError>;
}
