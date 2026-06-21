// Resolves the run-level working directory used by ModelStep input builds.
// Tool-local cwd values are validated by tool executors and must not mutate this state.
import { classifyProjectPath } from '@megumi/security/project-boundary-policy';

export interface ResolveModelStepEffectiveCwdInput {
  projectRoot?: string;
  requestedCwd?: string;
}

export interface ModelStepEffectiveCwd {
  absolutePath: string;
  projectRelativePath: string;
}

export function resolveModelStepEffectiveCwd(
  input: ResolveModelStepEffectiveCwdInput,
): ModelStepEffectiveCwd | undefined {
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
