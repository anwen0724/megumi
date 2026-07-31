/* Defines run_command, its process interface, bounded capture, and safe Skill script mapping. */

import type { JsonObject } from '@megumi/ai';
import type { SkillScriptExecutionRequest } from '@megumi/skills';
import type { RawToolResult, ToolDefinition } from '../tool';
import { normalizeRawToolContent, ToolExecutionFailure } from '../tool-result';
import { inputRecord, optionalPositiveInteger, optionalString, requireString } from './tool-input';
import type { BuiltInToolContext } from './workspace-file-access';

const MAX_STREAM_CAPTURE_BYTES = 20_000;
export const RUN_COMMAND_INTERNAL_METADATA = Symbol('run-command-internal-metadata');

export type ToolShellKind = 'powershell' | 'cmd' | 'posix_shell';
export type ToolProcessExecutionMethod = 'shell';

export interface ToolProcessAdapter {
  readonly shellKind: ToolShellKind;
  readonly executionMethod: ToolProcessExecutionMethod;
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
}

export interface RunCommandToolInput {
  readonly command: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly [RUN_COMMAND_INTERNAL_METADATA]?: JsonObject;
}

export function createRunCommandToolDefinition(process: ToolProcessAdapter): ToolDefinition {
  return {
    name: 'run_command',
    title: 'Run command',
    description: 'Run a command and return redacted output previews.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command line to run.' },
        cwd: { type: 'string', description: 'Optional working directory.' },
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
    capabilities: ['command_run'],
    riskLevel: 'medium',
    sideEffect: 'execute_command',
    availability: { status: 'available' },
    executionMode: 'serial',
    permissionMetadata: {
      ruleToolName: 'run_command',
      shellKind: process.shellKind,
      executionMethod: process.executionMethod,
    },
    modelFacingDescription: 'Run a command and return redacted output previews.',
  };
}

export function mapSkillScriptExecutionRequestToRunCommandInput(request: {
  readonly execution: SkillScriptExecutionRequest;
  readonly shellKind: ToolShellKind;
}): RunCommandToolInput {
  const execution = request.execution;
  const command = buildScriptCommand(execution.scriptPath, execution.args, request.shellKind);
  return {
    command,
    cwd: '.',
    [RUN_COMMAND_INTERNAL_METADATA]: {
      source: 'skill',
      skillPath: execution.skillPath,
      scriptName: execution.scriptName,
      approvalSummary: execution.approvalSummary,
      shellKind: request.shellKind,
    },
  };
}

export async function executeRunCommand(
  context: BuiltInToolContext,
  input: unknown,
  signal?: AbortSignal,
): Promise<RawToolResult> {
  if (!context.process) throw new Error('run_command requires a process adapter.');
  const record = inputRecord(input);
  const command = requireString(record, 'command');
  const cwd = await context.workspaceFileAccess.resolveCommandCwd({
    path: optionalString(record, 'cwd', '.'),
    signal,
  });
  const timeoutMs = optionalPositiveInteger(record, 'timeoutMs', 60_000);
  const internalMetadata = (record as Record<PropertyKey, unknown>)[RUN_COMMAND_INTERNAL_METADATA];
  const startedAt = Date.now();
  const result = await runShellCommand({
    command,
    cwd,
    timeoutMs,
    signal,
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
        code: 'tool_execution_failed' as const,
        message: `Command exited with code ${result.exitCode}.`,
        details: { reason: 'non_zero_exit', exitCode: result.exitCode },
      },
    } : {}),
    metadata: {
      shellKind: context.process.shellKind,
      executionMethod: context.process.executionMethod,
      ...(isInternalMetadata(internalMetadata) ? internalMetadata : {}),
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
        onStdout: (chunk) => stdout.append(chunk),
        onStderr: (chunk) => stderr.append(chunk),
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
  } catch {
    if (timedOut) throw timeoutFailure(input.timeoutMs);
    if (input.signal?.aborted) throw cancelledFailure();
    throw new ToolExecutionFailure(
      'Command process could not be started.',
      'tool_execution_failed',
      { reason: 'spawn_failed' },
    );
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', cancel);
  }
}

function buildScriptCommand(
  scriptPath: string,
  args: readonly string[],
  shellKind: ToolShellKind,
): string {
  const values = [scriptPath, ...args];
  values.forEach(assertSingleLineArgument);
  if (shellKind === 'powershell') {
    return `& ${values.map(quotePowerShellArgument).join(' ')}`;
  }
  if (shellKind === 'cmd') {
    return `call ${values.map(quoteCmdArgument).join(' ')}`;
  }
  return values.map(quotePosixArgument).join(' ');
}

function assertSingleLineArgument(value: string): void {
  if (value.includes('\0') || /[\r\n]/.test(value)) {
    throw new TypeError('Skill script arguments must be single-line strings without null bytes.');
  }
}

function quotePowerShellArgument(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteCmdArgument(value: string): string {
  return `"${value.replace(/%/g, '%%').replace(/"/g, '""')}"`;
}

function quotePosixArgument(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function timeoutFailure(timeoutMs: number): ToolExecutionFailure {
  return new ToolExecutionFailure(
    `Command timed out after ${timeoutMs}ms.`,
    'tool_execution_failed',
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

function isInternalMetadata(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

class BoundedByteCapture {
  private readonly chunks: Buffer[] = [];
  private capturedBytes = 0;
  public truncated = false;

  public constructor(private readonly maxBytes: number) {}

  public append(value: Uint8Array | string): void {
    const chunk = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
    const remaining = this.maxBytes - this.capturedBytes;
    if (remaining > 0) {
      const captured = chunk.subarray(0, remaining);
      this.chunks.push(captured);
      this.capturedBytes += captured.byteLength;
    }
    if (chunk.byteLength > remaining) this.truncated = true;
  }

  public toString(): string {
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
