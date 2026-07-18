/* Executes a bounded project-scoped shell command and captures output previews. */
import type { JsonObject } from '../../shared-json';
import type { RawToolResult } from '../contracts/tool-contracts';
import { inputRecord, optionalPositiveInteger, optionalString, requireString } from './input';
import type { BuiltInToolContext, BuiltInToolSpawn } from './types';

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
      stdoutPreview: truncateUtf8(result.stdout, 20_000).content,
      stderrPreview: truncateUtf8(result.stderr, 20_000).content,
      durationMs: Date.now() - startedAt,
      truncated: Buffer.byteLength(result.stdout + result.stderr, 'utf8') > 40_000,
    },
    isError: result.exitCode !== 0,
    ...(isJsonObject(record.metadata) ? { metadata: record.metadata } : {}),
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function truncateUtf8(content: string, maxBytes: number): { content: string; truncated: boolean } {
  const buffer = Buffer.from(content, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return { content, truncated: false };
  }
  return { content: buffer.subarray(0, maxBytes).toString('utf8'), truncated: true };
}

function runShellCommand(input: {
  command: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  spawn: BuiltInToolSpawn;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = input.spawn(input.command, [], {
      cwd: input.cwd,
      shell: true,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${input.timeoutMs}ms`));
    }, input.timeoutMs);

    input.signal?.addEventListener('abort', () => {
      child.kill();
      reject(new Error('Command execution was cancelled'));
    }, { once: true });

    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
  });
}
