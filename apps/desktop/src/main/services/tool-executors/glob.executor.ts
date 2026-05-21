import {
  globStaticBase,
  globToRegExp,
  inputRecord,
  requireString,
  successResult,
  walkProjectFiles,
  type ProjectToolExecutorContext,
  type SingleProjectToolExecutor,
} from './index';

export function createGlobExecutor(context: ProjectToolExecutorContext): SingleProjectToolExecutor {
  return {
    async execute(toolCall) {
      const input = inputRecord(toolCall);
      const pattern = requireString(input, 'pattern').replace(/\\/g, '/');
      const matcher = globToRegExp(pattern);
      const files = await walkProjectFiles(context, globStaticBase(pattern));
      const matches = files
        .map((file) => file.relativePath)
        .filter((filePath) => matcher.test(filePath));

      return successResult(context, toolCall, {
        structuredContent: { pattern, matches },
        textContent: matches.join('\n'),
      });
    },
  };
}
