import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { classifyProjectPath } from '@megumi/coding-agent/permissions/project-boundary-policy';
import { redactRuntimeMessage } from '../../security/redaction';
import { createRawToolResultFromContent } from '@megumi/coding-agent/tools/normalization';
import {
  inputRecord,
  optionalPositiveInteger,
  optionalString,
  requireString,
  type ProjectToolExecutorContext,
  type SingleProjectToolExecutor,
} from './index';

export const DEFAULT_TIMEOUT_MS = 120_000;
export const OUTPUT_LIMIT = 64 * 1024;

export interface RunCommandInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  envPolicy?: 'default' | 'minimal' | 'none';
}

export interface RunCommandResult {
  exitCode: number | null;
  stdoutPreview: string;
  stderrPreview: string;
  durationMs: number;
  truncated: boolean;
}

export interface ChildProcessLike {
  stdout?: {
    on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  };
  stderr?: {
    on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  };
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: (exitCode: number | null) => void): unknown;
  kill(): unknown;
}

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcessLike;

export interface RunCommandExecutorOptions extends Pick<ProjectToolExecutorContext, 'projectRoot' | 'now' | 'ids'> {
  spawn?: SpawnLike;
  nowMs?: () => number;
}

export interface RunCommandExecutor extends SingleProjectToolExecutor {
  runCommand(input: RunCommandInput): Promise<RunCommandResult>;
}

export function createRunCommandExecutor(options: RunCommandExecutorOptions): RunCommandExecutor {
  const spawn = options.spawn ?? (nodeSpawn as SpawnLike);
  const nowMs = options.nowMs ?? (() => Date.now());

  return {
    async runCommand(input) {
      const cwd = resolveProjectCwd(options.projectRoot, input.cwd ?? '.');
      const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const startedAt = nowMs();

      return new Promise<RunCommandResult>((resolve, reject) => {
        const stdout = createOutputCollector(OUTPUT_LIMIT);
        const stderr = createOutputCollector(OUTPUT_LIMIT);
        let settled = false;

        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', input.command], {
          cwd,
          env: resolveEnvironment(input.envPolicy),
          windowsHide: true,
        });

        const timer = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          child.kill();
          reject(new Error(`Command timed out after ${timeoutMs}ms.`));
        }, timeoutMs);

        child.stdout?.on('data', (chunk) => {
          stdout.append(chunk);
        });
        child.stderr?.on('data', (chunk) => {
          stderr.append(chunk);
        });
        child.on('error', (error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
        child.on('close', (exitCode) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          const stdoutPreview = stdout.preview();
          const stderrPreview = stderr.preview();

          resolve({
            exitCode,
            stdoutPreview: redactRuntimeMessage(stdoutPreview.content),
            stderrPreview: redactRuntimeMessage(stderrPreview.content),
            durationMs: Math.max(0, nowMs() - startedAt),
            truncated: stdoutPreview.truncated || stderrPreview.truncated,
          });
        });
      });
    },

    async execute(toolCall) {
      const input = inputRecord(toolCall);
      const command = requireString(input, 'command');
      const cwd = optionalString(input, 'cwd', '.');
      const timeoutMs = optionalPositiveInteger(input, 'timeoutMs', DEFAULT_TIMEOUT_MS);
      const envPolicy = readEnvPolicy(input);
      const result = await this.runCommand({ command, cwd, timeoutMs, envPolicy });
      const redactionState = result.stdoutPreview.includes('[redacted]') || result.stderrPreview.includes('[redacted]')
        ? 'redacted'
        : 'none';

      return createRawToolResultFromContent({
        rawToolResultId: options.ids.rawToolResultId?.() ?? options.ids.toolResultId(),
        toolExecutionId: String(toolCall.toolExecutionId),
        toolCallId: String(toolCall.toolCallId),
        isError: result.exitCode !== 0,
        outputKind: 'command',
        content: {
          structuredContent: {
            exitCode: result.exitCode,
            stdoutPreview: result.stdoutPreview,
            stderrPreview: result.stderrPreview,
            durationMs: result.durationMs,
            truncated: result.truncated,
          },
          textContent: formatRunCommandText(result),
          redactionState,
        },
        createdAt: options.now(),
      });
    },
  };
}

function readEnvPolicy(input: Record<string, unknown>): RunCommandInput['envPolicy'] {
  const value = input.envPolicy;
  if (value === undefined) {
    return undefined;
  }
  if (value === 'default' || value === 'minimal' || value === 'none') {
    return value;
  }
  throw new Error('Invalid envPolicy input.');
}

const MINIMAL_ENV_KEYS = [
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
  'ComSpec',
  'COMSPEC',
] as const;

function resolveEnvironment(envPolicy: RunCommandInput['envPolicy']): NodeJS.ProcessEnv {
  if (envPolicy === 'none') {
    return {};
  }
  if (envPolicy === 'minimal') {
    const env: NodeJS.ProcessEnv = {};
    for (const key of MINIMAL_ENV_KEYS) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }
    return env;
  }
  return process.env;
}

function resolveProjectCwd(projectRoot: string, cwd: string): string {
  const classification = classifyProjectPath({ projectRoot, targetPath: cwd });
  if (!classification.insideProject) {
    throw new Error(`Command cwd is outside the project: ${cwd}`);
  }
  return classification.absolutePath;
}

function createOutputCollector(maxBytes: number): {
  append(chunk: Buffer | string): void;
  preview(): { content: string; truncated: boolean };
} {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let truncated = false;

  return {
    append(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
      const remaining = maxBytes - byteLength;
      if (remaining <= 0) {
        if (buffer.byteLength > 0) {
          truncated = true;
        }
        return;
      }

      if (buffer.byteLength > remaining) {
        chunks.push(buffer.subarray(0, remaining));
        byteLength += remaining;
        truncated = true;
        return;
      }

      chunks.push(buffer);
      byteLength += buffer.byteLength;
    },
    preview() {
      const content = Buffer.concat(chunks, byteLength);
      return {
        content: trimToUtf8Boundary(content).toString('utf8'),
        truncated,
      };
    },
  };
}

function trimToUtf8Boundary(buffer: Buffer): Buffer {
  if (buffer.byteLength === 0) {
    return buffer;
  }

  let sequenceStart = buffer.byteLength - 1;
  while (sequenceStart >= 0 && (buffer[sequenceStart] & 0b1100_0000) === 0b1000_0000) {
    sequenceStart -= 1;
  }

  if (sequenceStart < 0) {
    return Buffer.alloc(0);
  }

  const leadByte = buffer[sequenceStart];
  const actualLength = buffer.byteLength - sequenceStart;
  let expectedLength = 1;

  if ((leadByte & 0b1111_1000) === 0b1111_0000) {
    expectedLength = 4;
  } else if ((leadByte & 0b1111_0000) === 0b1110_0000) {
    expectedLength = 3;
  } else if ((leadByte & 0b1110_0000) === 0b1100_0000) {
    expectedLength = 2;
  }

  if (actualLength < expectedLength) {
    return buffer.subarray(0, sequenceStart);
  }

  return buffer;
}

function formatRunCommandText(result: RunCommandResult): string {
  const sections = [
    `exitCode: ${result.exitCode === null ? 'null' : result.exitCode}`,
    `durationMs: ${result.durationMs}`,
  ];

  if (result.stdoutPreview) {
    sections.push(`stdout:\n${result.stdoutPreview}`);
  }
  if (result.stderrPreview) {
    sections.push(`stderr:\n${result.stderrPreview}`);
  }
  if (result.truncated) {
    sections.push('output truncated');
  }

  return sections.join('\n');
}
