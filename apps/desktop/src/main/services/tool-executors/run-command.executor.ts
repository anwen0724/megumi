import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { classifyProjectPath } from '@megumi/security/project-boundary-policy';
import { redactRuntimeMessage } from '@megumi/security/redaction';
import { normalizeToolResult } from '@megumi/tools/normalization';
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
        let stdout = '';
        let stderr = '';
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
          stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
          stderr += chunk.toString();
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
          const stdoutPreview = truncateUtf8(stdout, OUTPUT_LIMIT);
          const stderrPreview = truncateUtf8(stderr, OUTPUT_LIMIT);

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

      return normalizeToolResult(toolCall, {
        toolResultId: options.ids.toolResultId(),
        structuredContent: {
          exitCode: result.exitCode,
          stdoutPreview: result.stdoutPreview,
          stderrPreview: result.stderrPreview,
          durationMs: result.durationMs,
          truncated: result.truncated,
        },
        textContent: formatRunCommandText(result),
        redactionState,
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

function truncateUtf8(content: string, maxBytes: number): { content: string; truncated: boolean } {
  const buffer = Buffer.from(content, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return { content, truncated: false };
  }
  return {
    content: buffer.subarray(0, maxBytes).toString('utf8'),
    truncated: true,
  };
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
