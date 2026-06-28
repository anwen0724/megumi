// Resolves the run-level working directory used by ModelStep input builds.
// Tool-local cwd values are validated by tool executors and must not mutate this state.
import path from 'node:path';
import { classifyProjectPath } from '@megumi/coding-agent/workspace';

export interface ResolveModelCallEffectiveCwdInput {
  projectRoot?: string;
  requestedCwd?: string;
}

export interface ModelCallEffectiveCwd {
  absolutePath: string;
  projectRelativePath: string;
}

export interface ResolveMemoryRecallEffectiveCwdInput {
  projectRoot?: string;
  requestedCwd?: string;
}

export function resolveModelCallEffectiveCwd(
  input: ResolveModelCallEffectiveCwdInput,
): ModelCallEffectiveCwd | undefined {
  if (!input.projectRoot) {
    return undefined;
  }

  const targetPath = input.requestedCwd ?? '.';
  const classification = classifyProjectPath({
    projectRoot: input.projectRoot,
    targetPath,
  });

  if (!classification.insideProject) {
    throw new Error(`Effective cwd is outside the project: ${targetPath}`);
  }

  return {
    absolutePath: classification.absolutePath,
    projectRelativePath: classification.relativePath || '.',
  };
}

export function resolveMemoryRecallEffectiveCwd(
  input: ResolveMemoryRecallEffectiveCwdInput,
): string | undefined {
  if (!input.requestedCwd) {
    return input.projectRoot;
  }
  if (path.isAbsolute(input.requestedCwd) || isWindowsAbsolutePath(input.requestedCwd)) {
    return input.requestedCwd;
  }
  return input.projectRoot ? path.join(input.projectRoot, input.requestedCwd) : input.requestedCwd;
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}
