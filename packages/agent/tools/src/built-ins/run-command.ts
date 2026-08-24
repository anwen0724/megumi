/* Defines run_command, its process interface, bounded capture, and safe Skill script mapping. */

import type { JsonObject } from '../json';
import type { RawToolResult, ToolDefinition, ToolExecutionErrorCode, ToolExecutionOptions, ToolExecutionOutputChunk } from '../tool';
import { normalizeRawToolContent, ToolExecutionFailure } from '../tool-result';
import { inputRecord, optionalPositiveInteger, optionalString, requireString } from './tool-input';
import type { BuiltInToolContext } from './workspace-file-access';
import { createBuiltInToolHandler, inputString, operation } from './tool-handler';

const MAX_STREAM_CAPTURE_BYTES = 20_000;

export type ToolShellKind = 'powershell' | 'cmd' | 'posix_shell';
export type ToolProcessExecutionMethod = 'shell';

export interface ToolProcessDescriptor {
  readonly shellKind: ToolShellKind;
  readonly shellName: string;
  readonly executionMethod: ToolProcessExecutionMethod;
}

export interface ToolProcessAdapter extends ToolProcessDescriptor {
  run(
    request: ToolProcessRequest,
    options: ToolProcessOptions,
  ): Promise<ToolProcessResult>;
}

export interface ToolProcessRequest {
  readonly command: string;
  readonly cwd: string;
}

export interface ToolProcessOptions {
  readonly signal: AbortSignal;
  readonly onStdout: (chunk: Uint8Array | string) => void;
  readonly onStderr: (chunk: Uint8Array | string) => void;
}

export interface ToolProcessResult {
  readonly exitCode: number;
  readonly terminationConfirmed?: boolean;
}

export interface RunCommandToolInput {
  readonly command: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

export function createRunCommandToolDefinition(process: ToolProcessDescriptor): ToolDefinition {
  return {
    name: 'run_command',
    description: 'Run a command and return output previews. Captures up to 20,000 bytes per stream (stdout and stderr).',
  promptSnippet: 'Run a command and return redacted output previews.',
  promptGuidelines: ['Command output is redacted; sensitive values are replaced before they reach you.'],
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: `A command written for ${process.shellName}.`,
        },
        cwd: {
          type: 'string',
          description: 'The working directory for the command. Relative paths are resolved from the current working directory.',
        },
        timeoutMs: { type: 'integer', description: 'Optional timeout in milliseconds.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        exitCode: { type: 'integer' }, stdoutPreview: { type: 'string' },
        stderrPreview: { type: 'string' }, durationMs: { type: 'integer' },
        truncated: { type: 'boolean' },
      },
      required: ['exitCode', 'stdoutPreview', 'stderrPreview', 'durationMs', 'truncated'],
    },
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  };
}

export function createRunCommandToolHandler(process: ToolProcessDescriptor) {
  return createBuiltInToolHandler({
    toolName: 'run_command',
    operations: (invocation) => [
      operation(invocation, 'process.execute', {
        type: 'process.command',
        id: inputString(invocation, 'command'),
        attributes: { shellKind: process.shellKind },
      }),
      operation(invocation, 'workspace.read', {
        type: 'workspace.path',
        id: inputString(invocation, 'cwd', '.'),
      }),
    ],
    execute: (context, input, options) => executeRunCommand(context, input, options),
  });
}

export async function executeRunCommand(
  context: BuiltInToolContext,
  input: unknown,
  options: ToolExecutionOptions = {},
): Promise<RawToolResult> {
  if (!context.process) throw new Error('run_command requires a process adapter.');
  const record = inputRecord(input);
  const command = requireString(record, 'command');
  const cwd = await context.workspaceFileAccess.resolveCommandCwd({
    path: optionalString(record, 'cwd', '.'),
    signal: options.signal,
  });
  const timeoutMs = optionalPositiveInteger(record, 'timeoutMs', 60_000);
  const startedAt = Date.now();
  const result = await runShellCommand({
    command,
    cwd,
    timeoutMs,
    signal: options.signal,
    onOutput: options.onOutput,
    process: context.process,
  });
  const content = buildBoundedCommandContent({
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: Date.now() - startedAt,
    truncated: result.truncated,
  });
  return {
    outputKind: 'command',
    content,
    isError: result.exitCode !== 0,
    ...(result.exitCode !== 0 ? {
      error: {
        code: 'command_failed' as const,
        message: `Command exited with code ${result.exitCode}.`,
        details: { reason: 'non_zero_exit', exitCode: result.exitCode },
      },
    } : {}),
    metadata: {
      shellKind: context.process.shellKind,
      executionMethod: context.process.executionMethod,
    },
    effectReport: {
      coverage: 'unknown',
      effects: [],
      itemFailures: [],
      reason: 'run_command does not provide reliable Workspace file-effect observation.',
    },
  };
}

function buildBoundedCommandContent(input: {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly truncated: boolean;
}) {
  let stdoutPreview = input.stdout;
  let stderrPreview = input.stderr;
  let truncated = input.truncated;
  while (true) {
    const content = {
      exitCode: input.exitCode,
      stdoutPreview,
      stderrPreview,
      durationMs: input.durationMs,
      truncated,
    };
    if (!normalizeRawToolContent({ outputKind: 'command', content }).truncated) return content;
    const stdoutBytes = Buffer.byteLength(stdoutPreview, 'utf8');
    const stderrBytes = Buffer.byteLength(stderrPreview, 'utf8');
    if (stdoutBytes === 0 && stderrBytes === 0) {
      throw new Error('Unable to build a bounded run_command result.');
    }
    if (stdoutBytes >= stderrBytes && stdoutBytes > 0) {
      stdoutPreview = trimUtf8(stdoutPreview, Math.max(0, stdoutBytes - Math.max(1, Math.ceil(stdoutBytes / 8))));
    } else {
      stderrPreview = trimUtf8(stderrPreview, Math.max(0, stderrBytes - Math.max(1, Math.ceil(stderrBytes / 8))));
    }
    truncated = true;
  }
}

function trimUtf8(content: string, maxBytes: number): string {
  const bytes = Buffer.from(content, 'utf8');
  let end = Math.min(bytes.byteLength, maxBytes);
  while (end > 0 && !isCompleteUtf8Prefix(bytes.subarray(0, end))) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
}

async function runShellCommand(input: {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly onOutput?: (output: ToolExecutionOutputChunk) => void;
  readonly process: ToolProcessAdapter;
}): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string; readonly truncated: boolean }> {
  input.signal?.throwIfAborted();
  const controller = new AbortController();
  const stdout = new BoundedByteCapture(MAX_STREAM_CAPTURE_BYTES);
  const stderr = new BoundedByteCapture(MAX_STREAM_CAPTURE_BYTES);
  let timedOut = false;
  const cancel = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('Tool command timeout'));
  }, input.timeoutMs);
  try {
    const result = await input.process.run(
      { command: input.command, cwd: input.cwd },
      {
        signal: controller.signal,
        onStdout: (chunk) => publishCapturedOutput('stdout', stdout.append(chunk), stdout.truncated, input.onOutput),
        onStderr: (chunk) => publishCapturedOutput('stderr', stderr.append(chunk), stderr.truncated, input.onOutput),
      },
    );
    if (timedOut) throw timeoutFailure(input.timeoutMs);
    if (input.signal?.aborted) throw cancelledFailure();
    return {
      exitCode: result.exitCode,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      truncated: stdout.truncated || stderr.truncated,
    };
  } catch (error) {
    if (isStableProcessFailure(error) && error.code === 'termination_unconfirmed') throw processFailure(error);
    if (timedOut) throw timeoutFailure(input.timeoutMs);
    if (input.signal?.aborted) throw cancelledFailure();
    if (error instanceof ToolExecutionFailure) throw error;
    if (isStableProcessFailure(error)) throw processFailure(error);
    throw new ToolExecutionFailure(
      'Command process could not be started.',
      'shell_unavailable',
      { reason: 'spawn_failed' },
    );
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', cancel);
  }
}

function publishCapturedOutput(
  stream: 'stdout' | 'stderr',
  chunk: string,
  truncated: boolean,
  publish?: (output: ToolExecutionOutputChunk) => void,
): void {
  if (!publish || chunk.length === 0) return;
  publish({ stream, chunk: redactCommandOutput(chunk), truncated });
}

function redactCommandOutput(value: string): string {
  return value
    .replace(/\b(Authorization\s*:\s*Bearer)\s+[A-Za-z0-9._~+/=-]+/giu, '$1 [REDACTED]')
    .replace(/\b(api[-_ ]?key|token|password|secret)\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;]+)/giu, '$1=[REDACTED]');
}

const STABLE_PROCESS_FAILURE_CODES = new Set<ToolExecutionErrorCode>([
  'sandbox_unavailable', 'sandbox_denied', 'shell_unavailable',
  'tool_cancelled', 'tool_timeout', 'termination_unconfirmed', 'output_limit',
]);

function isStableProcessFailure(error: unknown): error is { readonly code: ToolExecutionErrorCode; readonly message: string } {
  return Boolean(error && typeof error === 'object'
    && 'code' in error && STABLE_PROCESS_FAILURE_CODES.has((error as { code: ToolExecutionErrorCode }).code)
    && 'message' in error && typeof (error as { message: unknown }).message === 'string');
}

function processFailure(error: { readonly code: ToolExecutionErrorCode; readonly message: string }): ToolExecutionFailure {
  return new ToolExecutionFailure(error.message, error.code, { reason: 'sandbox_process' });
}
function timeoutFailure(timeoutMs: number): ToolExecutionFailure {
  return new ToolExecutionFailure(
    `Command timed out after ${timeoutMs}ms.`,
    'tool_timeout',
    { reason: 'timeout', timeoutMs },
  );
}

function cancelledFailure(): ToolExecutionFailure {
  return new ToolExecutionFailure(
    'Command execution was cancelled.',
    'tool_cancelled',
    { reason: 'cancelled' },
  );
}

class BoundedByteCapture {
  private readonly chunks: Buffer[] = [];
  private capturedBytes = 0;
  public truncated = false;

  public constructor(private readonly maxBytes: number) {}

  public append(value: Uint8Array | string): string {
    const chunk = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
    const remaining = this.maxBytes - this.capturedBytes;
    let emitted = Buffer.alloc(0);
    if (remaining > 0) {
      emitted = chunk.subarray(0, remaining);
      this.chunks.push(emitted);
      this.capturedBytes += emitted.byteLength;
    }
    if (chunk.byteLength > remaining) this.truncated = true;
    return completeUtf8Prefix(emitted).toString('utf8');
  }

  public toString(): string {
    return completeUtf8Prefix(Buffer.concat(this.chunks)).toString('utf8');
  }
}

function completeUtf8Prefix(content: Buffer): Buffer {
  let end = content.byteLength;
  while (end > 0 && !isCompleteUtf8Prefix(content.subarray(0, end))) end -= 1;
  return content.subarray(0, end);
}

function isCompleteUtf8Prefix(content: Buffer): boolean {
  let start = 0;
  while (start < content.byteLength) {
    const leading = content[start];
    const expectedLength = leading < 0x80 ? 1
      : (leading & 0xE0) === 0xC0 ? 2
        : (leading & 0xF0) === 0xE0 ? 3
          : (leading & 0xF8) === 0xF0 ? 4
            : 1;
    if (content.byteLength - start < expectedLength) return false;
    start += expectedLength;
  }
  return true;
}
