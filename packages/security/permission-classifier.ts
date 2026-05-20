import type { PermissionMode } from '@megumi/shared/permission-mode-contracts';
import type {
  PermissionClassifierLabel,
  ToolCapability,
  ToolPolicyDecisionValue,
  ToolSideEffect,
} from '@megumi/shared/tool-contracts';
import type { CommandClassifierLabel } from './command-classifier';

export interface PermissionClassifierInput {
  permissionMode: PermissionMode;
  toolName: string;
  capability: ToolCapability;
  sideEffect: ToolSideEffect;
  commandLabel?: CommandClassifierLabel;
  projectPath?: {
    insideProject: boolean;
    protected: boolean;
    sensitive: boolean;
  };
}

export interface PermissionClassifierResult {
  decision: ToolPolicyDecisionValue;
  classifierLabel: PermissionClassifierLabel;
  reason: string;
  confidence: number;
}

export interface PermissionClassifier {
  classify(input: PermissionClassifierInput): PermissionClassifierResult;
}

export function createRuleBasedPermissionClassifier(): PermissionClassifier {
  return {
    classify(input) {
      if (input.projectPath && (!input.projectPath.insideProject || input.projectPath.protected)) {
        return {
          decision: 'deny',
          classifierLabel: 'project_boundary',
          reason: 'Auto classifier does not allow project escape or protected paths.',
          confidence: 1,
        };
      }

      if (input.projectPath?.sensitive) {
        return {
          decision: 'ask',
          classifierLabel: 'sensitive_policy',
          reason: 'Auto classifier requires confirmation for sensitive paths.',
          confidence: 0.9,
        };
      }

      if (input.capability === 'project_write' && input.sideEffect === 'project_file_operation') {
        if (!input.projectPath?.insideProject || input.projectPath.protected || input.projectPath.sensitive) {
          return {
            decision: 'ask',
            classifierLabel: 'project_file_operation',
            reason: 'Auto requires confirmed ordinary project path before allowing file edits.',
            confidence: 0.7,
          };
        }

        return {
          decision: 'allow',
          classifierLabel: 'project_file_operation',
          reason: 'Auto allows ordinary project file edits.',
          confidence: 0.8,
        };
      }

      if (input.capability === 'project_write') {
        return {
          decision: 'ask',
          classifierLabel: 'project_file_operation',
          reason: 'Auto requires project path evidence before allowing project writes.',
          confidence: 0.7,
        };
      }

      if (input.capability === 'project_read' || input.sideEffect === 'none') {
        return {
          decision: 'allow',
          classifierLabel: 'read_only',
          reason: 'Auto allows project-local read.',
          confidence: 0.95,
        };
      }

      if (isAutoAllowedCommand(input.commandLabel)) {
        return {
          decision: 'allow',
          classifierLabel: input.commandLabel,
          reason: `Auto allows ${input.commandLabel} command.`,
          confidence: 0.85,
        };
      }

      if (input.commandLabel === 'destructive' || input.commandLabel === 'infrastructure_or_deploy') {
        return {
          decision: 'deny',
          classifierLabel: input.commandLabel,
          reason: `Auto denies high-risk ${input.commandLabel} command.`,
          confidence: 0.95,
        };
      }

      return {
        decision: 'ask',
        classifierLabel: input.commandLabel ?? 'unknown',
        reason: 'Auto classifier could not safely allow this action.',
        confidence: 0.5,
      };
    },
  };
}

function isAutoAllowedCommand(
  commandLabel: CommandClassifierLabel | undefined,
): commandLabel is 'read_only' | 'search_or_list' | 'git_read' | 'verification' {
  return commandLabel === 'read_only'
    || commandLabel === 'search_or_list'
    || commandLabel === 'git_read'
    || commandLabel === 'verification';
}
