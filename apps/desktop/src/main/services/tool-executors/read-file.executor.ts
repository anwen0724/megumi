import {
  inputRecord,
  optionalPositiveInteger,
  redactToolText,
  resolveProjectPath,
  successResult,
  truncateUtf8,
  type ProjectToolExecutorContext,
  type SingleProjectToolExecutor,
} from './index';

const DEFAULT_MAX_BYTES = 256 * 1024;

export function createReadFileExecutor(context: ProjectToolExecutorContext): SingleProjectToolExecutor {
  return {
    async execute(toolCall) {
      const input = inputRecord(toolCall);
      const path = String(input.path ?? '');
      if (!path) {
        throw new Error('Missing or invalid string input: path');
      }
      const maxBytes = optionalPositiveInteger(input, 'maxBytes', DEFAULT_MAX_BYTES);
      const resolved = resolveProjectPath(context, path);
      const rawContent = await context.fileSystem.readFile(resolved.absolutePath, 'utf8');
      const truncated = truncateUtf8(rawContent, maxBytes);
      const redacted = redactToolText(truncated.content);

      return successResult(context, toolCall, {
        structuredContent: {
          path: resolved.relativePath,
          content: redacted.content,
          truncated: truncated.truncated,
          sizeBytes: Buffer.byteLength(rawContent, 'utf8'),
        },
        textContent: redacted.content,
        redactionState: redacted.redactionState,
      });
    },
  };
}
