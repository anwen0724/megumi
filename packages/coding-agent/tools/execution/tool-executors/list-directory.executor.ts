import path from 'node:path';
import { classifyProjectPath } from '@megumi/coding-agent/workspace';
import {
  inputRecord,
  isHiddenProjectPath,
  optionalString,
  resolveProjectPath,
  successResult,
  type ProjectToolExecutorContext,
  type SingleProjectToolExecutor,
} from './index';

export function createListDirectoryExecutor(context: ProjectToolExecutorContext): SingleProjectToolExecutor {
  return {
    async execute(toolCall) {
      const input = inputRecord(toolCall);
      const requestedPath = optionalString(input, 'path', '.');
      const resolved = resolveProjectPath(context, requestedPath);
      if (resolved.protected || resolved.sensitive) {
        throw new Error(`Project path cannot be listed: ${resolved.relativePath}`);
      }

      const entries = await context.fileSystem.readdir(resolved.absolutePath, { withFileTypes: true });
      const visibleEntries = entries
        .filter((entry) => entry.isFile() || entry.isDirectory())
        .flatMap((entry) => {
          const relativePath = resolved.relativePath === '.'
            ? entry.name
            : `${resolved.relativePath}/${entry.name}`;
          const classification = classifyProjectPath({
            projectRoot: context.projectRoot,
            targetPath: relativePath,
          });
          if (!classification.insideProject || isHiddenProjectPath(
            classification.relativePath,
            classification.protected,
            classification.sensitive,
          )) {
            return [];
          }
          return [{
            name: entry.name,
            kind: entry.isDirectory() ? 'directory' as const : 'file' as const,
            path: classification.relativePath,
          }];
        })
        .sort((left, right) => {
          if (left.kind !== right.kind) {
            return left.kind === 'directory' ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        });

      return successResult(context, toolCall, {
        structuredContent: {
          path: resolved.relativePath,
          entries: visibleEntries,
        },
        textContent: visibleEntries.map((entry) => `${entry.kind}\t${path.posix.basename(entry.path)}`).join('\n'),
      });
    },
  };
}
