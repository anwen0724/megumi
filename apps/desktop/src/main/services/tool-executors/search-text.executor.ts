import {
  inputRecord,
  optionalString,
  redactToolText,
  requireString,
  successResult,
  walkProjectFiles,
  type ProjectToolExecutorContext,
  type SingleProjectToolExecutor,
} from './index';

export function createSearchTextExecutor(context: ProjectToolExecutorContext): SingleProjectToolExecutor {
  return {
    async execute(toolCall) {
      const input = inputRecord(toolCall);
      const query = requireString(input, 'query');
      const searchPath = optionalString(input, 'path', '.');
      const files = await walkProjectFiles(context, searchPath);
      const matches: Array<{ path: string; line: number; snippet: string }> = [];
      let redactionState: 'none' | 'redacted' = 'none';

      for (const file of files) {
        const content = await context.fileSystem.readFile(file.absolutePath, 'utf8');
        const lines = content.split(/\r?\n/);
        lines.forEach((line, index) => {
          if (!line.includes(query)) {
            return;
          }
          const redacted = redactToolText(line);
          if (redacted.redactionState === 'redacted') {
            redactionState = 'redacted';
          }
          matches.push({
            path: file.relativePath,
            line: index + 1,
            snippet: redacted.content,
          });
        });
      }

      return successResult(context, toolCall, {
        structuredContent: { query, path: searchPath, matches },
        textContent: matches.map((match) => `${match.path}:${match.line}: ${match.snippet}`).join('\n'),
        redactionState,
      });
    },
  };
}
