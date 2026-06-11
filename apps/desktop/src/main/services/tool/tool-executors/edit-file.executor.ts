import {
  assertOrdinaryProjectPath,
  inputRecord,
  requireString,
  successResult,
  type ProjectToolExecutorContext,
  type SingleProjectToolExecutor,
} from './index';

export function createEditFileExecutor(context: ProjectToolExecutorContext): SingleProjectToolExecutor {
  return {
    async execute(toolCall) {
      const input = inputRecord(toolCall);
      const path = requireString(input, 'path');
      const oldText = requireString(input, 'oldText');
      const newText = requireString(input, 'newText');
      if (!oldText) {
        throw new Error('oldText must not be empty.');
      }

      const resolved = assertOrdinaryProjectPath(context, path);
      const content = await context.fileSystem.readFile(resolved.absolutePath, 'utf8');
      const replacements = content.split(oldText).length - 1;
      if (replacements === 0) {
        throw new Error(`oldText not found in project file: ${resolved.relativePath}`);
      }

      const updated = content.split(oldText).join(newText);
      await context.fileSystem.writeFile(resolved.absolutePath, updated, 'utf8');

      return successResult(context, toolCall, {
        structuredContent: {
          path: resolved.relativePath,
          replacements,
        },
        textContent: `Replaced ${replacements} occurrence${replacements === 1 ? '' : 's'} in ${resolved.relativePath}.`,
      });
    },
  };
}
