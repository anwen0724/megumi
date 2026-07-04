/*
 * Conservatively classifies shell commands for permission policy decisions.
 * It never executes commands and intentionally avoids full shell grammar parsing.
 */
export const COMMAND_CLASSIFIER_LABELS = [
  'read_only',
  'verification',
  'search_or_list',
  'project_file_operation',
  'dependency_install',
  'git_read',
  'git_mutation',
  'network',
  'destructive',
  'infrastructure_or_deploy',
  'secret_or_env',
  'unknown',
] as const;

export type CommandClassifierLabel = (typeof COMMAND_CLASSIFIER_LABELS)[number];

export interface CommandClassification {
  label: CommandClassifierLabel;
  reason: string;
  normalized_command: string;
}

export function classifyCommand(command: string): CommandClassification {
  const normalized = command.trim().replace(/\s+/g, ' ');

  if (isDestructiveCommand(normalized)) {
    return classified('destructive', normalized, 'Command may destructively remove or alter data.');
  }
  if (isSecretOrEnvCommand(normalized)) {
    return classified('secret_or_env', normalized, 'Command may expose secrets or environment values.');
  }
  if (isNetworkCommand(normalized)) {
    return classified('network', normalized, 'Command may access network or remote hosts.');
  }
  if (isInfrastructureOrDeployCommand(normalized)) {
    return classified('infrastructure_or_deploy', normalized, 'Command may mutate infrastructure or deployment state.');
  }
  if (isGitMutationCommand(normalized)) {
    return classified('git_mutation', normalized, 'Command mutates git state.');
  }
  if (isDependencyInstallCommand(normalized)) {
    return classified('dependency_install', normalized, 'Command changes dependencies or downloads packages.');
  }
  if (hasShellControlOrRedirection(normalized)) {
    return classified(
      'project_file_operation',
      normalized,
      'Command uses shell redirection or control operators, which may mutate files or alter execution flow.',
    );
  }
  if (isVerificationCommand(normalized)) {
    return classified('verification', normalized, 'Command verifies project behavior without intended mutation.');
  }
  if (isGitReadCommand(normalized)) {
    return classified('git_read', normalized, 'Command reads git state.');
  }
  if (isSearchOrListCommand(normalized)) {
    return classified('search_or_list', normalized, 'Command searches or lists project content.');
  }
  if (isReadOnlyCommand(normalized)) {
    return classified('read_only', normalized, 'Command reads shell or file metadata.');
  }

  return classified('unknown', normalized, 'Command did not match a known conservative rule.');
}

function classified(label: CommandClassifierLabel, normalizedCommand: string, reason: string): CommandClassification {
  return {
    label,
    reason,
    normalized_command: normalizedCommand,
  };
}

function hasShellControlOrRedirection(command: string): boolean {
  return /(?:>>?|<|\|\||\||&&|;)/.test(command);
}

function isReadOnlyCommand(command: string): boolean {
  return /^(pwd|cd\s+\S+|ls\b|dir\b|tree\b|cat\s+|type\s+|Get-ChildItem\b|Get-Content\b)/i.test(command);
}

function isSearchOrListCommand(command: string): boolean {
  return /^(rg|grep|findstr|git grep)\b/i.test(command);
}

function isVerificationCommand(command: string): boolean {
  return /^(npm|pnpm|yarn)\s+(test|run test|run lint|run build|run typecheck)\b/i.test(command)
    || /^npx(?:\.cmd)?\s+(vitest|tsc)\b/i.test(command)
    || /^(vitest|tsc)\b/i.test(command);
}

function isGitReadCommand(command: string): boolean {
  return /^git\s+(status|diff|log|show|branch(\s+--show-current)?)\b/i.test(command);
}

function isGitMutationCommand(command: string): boolean {
  return /^git\s+(add|commit|push|pull|merge|rebase|checkout|switch|restore|reset|cherry-pick|stash|tag)\b/i.test(command);
}

function isDependencyInstallCommand(command: string): boolean {
  return /^(npm|pnpm|yarn)\s+(install|add|remove|update|upgrade)\b/i.test(command)
    || /^npx(?:\.cmd)?\s+.+\s+add\b/i.test(command);
}

function isNetworkCommand(command: string): boolean {
  return /\b(curl|wget|Invoke-WebRequest|iwr|ssh|scp|rsync)\b/i.test(command);
}

function isDestructiveCommand(command: string): boolean {
  return /\b(rm\s+-rf|Remove-Item\b|del\s+\/s|del\s+|erase\s+|format\b|mkfs\b|shutdown\b)\b/i.test(command)
    || /^git\s+reset\s+--hard\b/i.test(command)
    || /\b(move|mv)\s+.+\s+.+/i.test(command);
}

function isInfrastructureOrDeployCommand(command: string): boolean {
  return /\b(kubectl|terraform|pulumi|flyctl|vercel|netlify|aws|gcloud|az)\b/i.test(command);
}

function isSecretOrEnvCommand(command: string): boolean {
  return /\b(env|printenv|set)\b|\.env|\b(SECRET|TOKEN|KEY)\b/i.test(command);
}
