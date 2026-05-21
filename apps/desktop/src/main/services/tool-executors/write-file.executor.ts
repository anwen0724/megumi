import path from 'node:path';
import {
  assertOrdinaryProjectPath,
  inputRecord,
  requireString,
  successResult,
  type ProjectToolExecutorContext,
  type SingleProjectToolExecutor,
} from './index';

export function createWriteFileExecutor(context: ProjectToolExecutorContext): SingleProjectToolExecutor {
  return {
    async execute(toolCall) {
      const input = inputRecord(toolCall);
      const filePath = requireString(input, 'path');
      const content = requireString(input, 'content');
      const resolved = assertOrdinaryProjectPath(context, filePath);
      const overwritten = await pathExists(context, resolved.absolutePath);

      await context.fileSystem.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
      await context.fileSystem.writeFile(resolved.absolutePath, content, 'utf8');

      return successResult(context, toolCall, {
        structuredContent: {
          path: resolved.relativePath,
          created: !overwritten,
          overwritten,
        },
        textContent: `${overwritten ? 'Overwrote' : 'Created'} ${resolved.relativePath}.`,
      });
    },
  };
}

async function pathExists(context: ProjectToolExecutorContext, filePath: string): Promise<boolean> {
  try {
    const stats = await context.fileSystem.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}
