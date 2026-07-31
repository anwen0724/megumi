/*
 * Conservatively parses supported Shell Command forms for Permission risk assessment.
 */
import type { ToolShellKind } from '@megumi/tools';

export const SHELL_COMMAND_CLASSIFICATIONS = [
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
  'nested_shell',
  'unknown',
  'unknown_shell',
] as const;

export type ShellCommandClassification = (typeof SHELL_COMMAND_CLASSIFICATIONS)[number];

export interface ShellCommandAssessment {
  readonly classification: ShellCommandClassification;
  readonly reason: string;
  readonly normalizedCommand: string;
  readonly shellKind: ToolShellKind | 'unknown';
  readonly segments: readonly string[];
  readonly hasControlOperator: boolean;
  readonly hasRedirection: boolean;
}

export function classifyShellCommand(request: {
  readonly command: string;
  readonly shellKind: ToolShellKind | 'unknown';
}): ShellCommandAssessment {
  const normalizedCommand = request.command.trim().replace(/\s+/g, ' ');
  if (request.shellKind === 'unknown') {
    return {
      classification: 'unknown_shell',
      reason: 'The Shell kind is not supported, so command risk cannot be parsed safely.',
      normalizedCommand,
      shellKind: request.shellKind,
      segments: normalizedCommand ? [normalizedCommand] : [],
      hasControlOperator: true,
      hasRedirection: false,
    };
  }

  const parsed = splitShellSegments(request.command, request.shellKind);
  const segmentAssessments = parsed.segments.map(classifySegment);
  let highest = segmentAssessments.slice(1).reduce<ShellCommandClassification>(
    (current, candidate) => riskRank(candidate) > riskRank(current) ? candidate : current,
    segmentAssessments[0] ?? 'unknown',
  );
  if (parsed.hasControlOperator && riskRank(highest) <= riskRank('git_read')) {
    highest = 'project_file_operation';
  }
  if (parsed.segments.some(isNestedShell) && riskRank(highest) < riskRank('destructive')) {
    highest = 'nested_shell';
  }
  if (parsed.segments.length === 0) highest = 'unknown';

  return {
    classification: highest,
    reason: reasonFor(highest),
    normalizedCommand,
    shellKind: request.shellKind,
    segments: parsed.segments,
    hasControlOperator: parsed.hasControlOperator,
    hasRedirection: parsed.hasRedirection,
  };
}

function splitShellSegments(command: string, shellKind: ToolShellKind): {
  segments: string[];
  hasControlOperator: boolean;
  hasRedirection: boolean;
} {
  const segments: string[] = [];
  let current = '';
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let hasControlOperator = false;
  let hasRedirection = false;

  const commit = () => {
    const value = current.trim();
    if (value) segments.push(value.replace(/\s+/g, ' '));
    current = '';
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if ((shellKind === 'powershell' && character === '`')
      || (shellKind === 'cmd' && character === '^')
      || (shellKind === 'posix_shell' && character === '\\')) {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }

    const next = command[index + 1];
    const isRedirection = character === '>' || character === '<';
    const isPipe = character === '|';
    const isAnd = character === '&';
    const isSemicolon = character === ';' && shellKind !== 'cmd';
    if (isRedirection || isPipe || isAnd || isSemicolon) {
      hasControlOperator = true;
      hasRedirection ||= isRedirection;
      commit();
      if ((isPipe || isAnd || isRedirection) && next === character) index += 1;
      continue;
    }
    current += character;
  }
  commit();
  return { segments, hasControlOperator, hasRedirection };
}

function classifySegment(command: string): ShellCommandClassification {
  if (isDestructiveCommand(command)) return 'destructive';
  if (isSecretOrEnvCommand(command)) return 'secret_or_env';
  if (isInfrastructureOrDeployCommand(command)) return 'infrastructure_or_deploy';
  if (isDependencyInstallCommand(command)) return 'dependency_install';
  if (isGitMutationCommand(command)) return 'git_mutation';
  if (isNetworkCommand(command)) return 'network';
  if (isVerificationCommand(command)) return 'verification';
  if (isGitReadCommand(command)) return 'git_read';
  if (isSearchOrListCommand(command)) return 'search_or_list';
  if (isReadOnlyCommand(command)) return 'read_only';
  return 'unknown';
}

function isReadOnlyCommand(command: string): boolean {
  return /^(pwd|cd\s+\S+|ls\b|dir\b|tree\b|cat\s+|type\s+|Get-ChildItem\b|Get-Content\b|echo\b)/i.test(command);
}

function isSearchOrListCommand(command: string): boolean {
  return /^(rg|grep|findstr|git grep|Select-String)\b/i.test(command);
}

function isVerificationCommand(command: string): boolean {
  return /^(npm|pnpm|yarn)(?:\.cmd)?\s+(test|run test|run lint|run build|run typecheck)\b/i.test(command)
    || /^npx(?:\.cmd)?\s+(vitest|tsc)\b/i.test(command)
    || /^(vitest|tsc)\b/i.test(command);
}

function isGitReadCommand(command: string): boolean {
  return /^git\s+(status|diff|log|show|branch(?:\s+--show-current)?)\b/i.test(command);
}

function isGitMutationCommand(command: string): boolean {
  return /^git\s+(add|commit|push|pull|merge|rebase|checkout|switch|restore|reset|cherry-pick|stash|tag)\b/i.test(command);
}

function isDependencyInstallCommand(command: string): boolean {
  return /^(npm|pnpm|yarn)(?:\.cmd)?\s+(install|add|remove|update|upgrade)\b/i.test(command)
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

function isNestedShell(command: string): boolean {
  return /^(powershell|pwsh|cmd(?:\.exe)?|sh|bash|zsh|fish)\b.*(?:-command|-c|\/c)\b/i.test(command);
}

function riskRank(classification: ShellCommandClassification): number {
  const ranks: Record<ShellCommandClassification, number> = {
    read_only: 0,
    verification: 0,
    search_or_list: 0,
    git_read: 0,
    project_file_operation: 1,
    dependency_install: 1,
    git_mutation: 1,
    network: 1,
    unknown: 1,
    destructive: 2,
    infrastructure_or_deploy: 2,
    secret_or_env: 2,
    nested_shell: 2,
    unknown_shell: 2,
  };
  return ranks[classification];
}

function reasonFor(classification: ShellCommandClassification): string {
  const reasons: Record<ShellCommandClassification, string> = {
    read_only: 'Command reads shell or file metadata.',
    verification: 'Command verifies project behavior without intended mutation.',
    search_or_list: 'Command searches or lists project content.',
    project_file_operation: 'Command may mutate files or alter execution flow.',
    dependency_install: 'Command changes dependencies or downloads packages.',
    git_read: 'Command reads Git state.',
    git_mutation: 'Command mutates Git state.',
    network: 'Command may access network or remote hosts.',
    destructive: 'Command may destructively remove or alter data.',
    infrastructure_or_deploy: 'Command may mutate infrastructure or deployment state.',
    secret_or_env: 'Command may expose secrets or environment values.',
    nested_shell: 'Nested Shell invocation prevents reliable analysis of the complete command.',
    unknown: 'Command did not match a known conservative rule.',
    unknown_shell: 'The Shell kind is not supported.',
  };
  return reasons[classification];
}
