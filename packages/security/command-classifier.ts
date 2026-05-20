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
  normalizedCommand: string;
}

export function classifyCommand(command: string): CommandClassification {
  const normalizedCommand = normalizeCommand(command);

  if (isDestructiveCommand(normalizedCommand)) {
    return classify('destructive', normalizedCommand, 'Command may destructively remove or alter data.');
  }

  if (isSecretOrEnvCommand(normalizedCommand)) {
    return classify('secret_or_env', normalizedCommand, 'Command may expose secrets or environment values.');
  }

  if (isNetworkCommand(normalizedCommand)) {
    return classify('network', normalizedCommand, 'Command may access network or remote hosts.');
  }

  if (isInfrastructureOrDeployCommand(normalizedCommand)) {
    return classify(
      'infrastructure_or_deploy',
      normalizedCommand,
      'Command may mutate infrastructure or deployment state.',
    );
  }

  if (isGitMutationCommand(normalizedCommand)) {
    return classify('git_mutation', normalizedCommand, 'Command mutates git state.');
  }

  if (isDependencyInstallCommand(normalizedCommand)) {
    return classify('dependency_install', normalizedCommand, 'Command changes dependencies or downloads packages.');
  }

  if (hasShellControlOrRedirection(normalizedCommand)) {
    return classify(
      'project_file_operation',
      normalizedCommand,
      'Command uses shell redirection or control operators, which may mutate files or alter execution flow.',
    );
  }

  if (isVerificationCommand(normalizedCommand)) {
    return classify('verification', normalizedCommand, 'Command verifies project behavior without intended mutation.');
  }

  if (isGitReadCommand(normalizedCommand)) {
    return classify('git_read', normalizedCommand, 'Command reads git state.');
  }

  if (isSearchOrListCommand(normalizedCommand)) {
    return classify('search_or_list', normalizedCommand, 'Command searches or lists project content.');
  }

  if (isReadOnlyCommand(normalizedCommand)) {
    return classify('read_only', normalizedCommand, 'Command reads shell or file metadata.');
  }

  return classify('unknown', normalizedCommand, 'Command did not match a known conservative rule.');
}

function classify(
  label: CommandClassifierLabel,
  normalizedCommand: string,
  reason: string,
): CommandClassification {
  return {
    label,
    reason,
    normalizedCommand,
  };
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
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
    || /^npx\s+(vitest|tsc)\b/i.test(command)
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
    || /^npx\s+.+\s+add\b/i.test(command);
}

function isNetworkCommand(command: string): boolean {
  return /\b(curl|wget|Invoke-WebRequest|iwr|ssh|scp|rsync)\b/i.test(command);
}

function isDestructiveCommand(command: string): boolean {
  return /\b(rm\s+-rf|Remove-Item\b|del\s+|erase\s+|format\b|mkfs\b|shutdown\b)\b/i.test(command);
}

function isInfrastructureOrDeployCommand(command: string): boolean {
  return /\b(kubectl|terraform|pulumi|flyctl|vercel|netlify|aws|gcloud|az)\b/i.test(command);
}

function isSecretOrEnvCommand(command: string): boolean {
  return /\b(env|printenv|set)\b|\.env|\b(SECRET|TOKEN|KEY)\b/i.test(command);
}
