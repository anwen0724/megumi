/* Executes a bounded project-scoped shell command and captures output previews. */
import type { RawToolResult } from '../contracts/tool-contracts';
import { RUN_COMMAND_INTERNAL_METADATA } from '../core/skill-script-tool-mapper';
import { ToolExecutionFailure } from '../core/tool-execution-failure';
import { inputRecord, optionalPositiveInteger, optionalString, requireString } from './input';
import type { BuiltInToolContext, BuiltInToolSpawn } from './types';

const MAX_STREAM_CAPTURE_BYTES = 20_000;

export async function executeRunCommand(
  context: BuiltInToolContext,
  input: unknown,
  signal?: AbortSignal,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const command = requireString(record, 'command');
  const cwd = await context.workspaceFileAccess.resolveCommandCwd({
    path: optionalString(record, 'cwd', '.'),
  });
  const timeoutMs = optionalPositiveInteger(record, 'timeoutMs', 60_000);
  const internalMetadata = (record as Record<PropertyKey, unknown>)[RUN_COMMAND_INTERNAL_METADATA];
  const startedAt = Date.now();
  const result = await runShellCommand({
    command,
    cwd,
    timeoutMs,
    signal,
    spawn: context.spawn,
  });

  return {
    outputKind: 'command',
    content: {
      exitCode: result.exitCode,
      stdoutPreview: result.stdout,
      stderrPreview: result.stderr,
      durationMs: Date.now() - startedAt,
      truncated: result.truncated,
    },
    isError: result.exitCode !== 0,
    ...(result.exitCode !== 0 ? {
      error: {
        code: 'tool_execution_failed' as const,
        message: `Command exited with code ${result.exitCode}.`,
        details: { reason: 'non_zero_exit', exitCode: result.exitCode },
      },
    } : {}),
    ...(isInternalMetadata(internalMetadata)
      ? { metadata: internalMetadata }
      : {}),
  };
}

function isInternalMetadata(value: unknown): value is import('../../shared-json').JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function runShellCommand(input: {
  command: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  spawn: BuiltInToolSpawn;
}): Promise<{ exitCode: number; stdout: string; stderr: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = input.spawn(input.command, [], {
      cwd: input.cwd,
      shell: true,
      windowsHide: true,
    });
    const stdout = new BoundedByteCapture(MAX_STREAM_CAPTURE_BYTES);
    const stderr = new BoundedByteCapture(MAX_STREAM_CAPTURE_BYTES);
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', cancel);
      reject(error);
    };
    const timeout = setTimeout(() => {
      fail(new ToolExecutionFailure(
        `Command timed out after ${input.timeoutMs}ms.`,
        'tool_execution_failed',
        { reason: 'timeout', timeoutMs: input.timeoutMs },
      ));
      child.kill();
    }, input.timeoutMs);

    const cancel = () => {
      fail(new ToolExecutionFailure(
        'Command execution was cancelled.',
        'tool_cancelled',
        { reason: 'cancelled' },
      ));
      child.kill();
    };
    input.signal?.addEventListener('abort', cancel, { once: true });

    child.stdout?.on('data', (chunk) => { stdout.append(chunk); });
    child.stderr?.on('data', (chunk) => { stderr.append(chunk); });
    child.on('error', () => {
      fail(new ToolExecutionFailure(
        'Command process could not be started.',
        'tool_execution_failed',
        { reason: 'spawn_failed' },
      ));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', cancel);
      resolve({
        exitCode: code ?? 0,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        truncated: stdout.truncated || stderr.truncated,
      });
    });
  });
}

class BoundedByteCapture {
  private readonly chunks: Buffer[] = [];
  private capturedBytes = 0;
  truncated = false;

  constructor(private readonly maxBytes: number) {}

  append(value: unknown): void {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    const remaining = this.maxBytes - this.capturedBytes;
    if (remaining > 0) {
      const captured = chunk.subarray(0, remaining);
      this.chunks.push(captured);
      this.capturedBytes += captured.byteLength;
    }
    if (chunk.byteLength > remaining) {
      this.truncated = true;
    }
  }

  toString(): string {
    const content = Buffer.concat(this.chunks);
    let end = content.byteLength;
    while (end > 0 && !isCompleteUtf8Prefix(content.subarray(0, end))) end -= 1;
    return content.subarray(0, end).toString('utf8');
  }
}

function isCompleteUtf8Prefix(content: Buffer): boolean {
  if (content.byteLength === 0) return true;
  let start = content.byteLength - 1;
  while (start > 0 && (content[start] & 0xC0) === 0x80) start -= 1;
  const leading = content[start];
  const expectedLength = leading < 0x80 ? 1
    : (leading & 0xE0) === 0xC0 ? 2
      : (leading & 0xF0) === 0xE0 ? 3
        : (leading & 0xF8) === 0xF0 ? 4
          : 1;
  return content.byteLength - start >= expectedLength;
}
