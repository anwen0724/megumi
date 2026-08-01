/* Runs Windows commands in either an AppContainer or an unrestricted bounded Job Object. */

import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SandboxCapabilities } from './sandbox';
import { SandboxProcessError, type SandboxProcess } from './sandbox-process';
import { WINDOWS_JOB_LAUNCHER_SOURCE } from './windows-job-launcher-source';

const HELPER_ERROR_PREFIX = 'MEGUMI_SANDBOX_ERROR:';
let helperPromise: Promise<string> | undefined;
const reservedDriveLetters = new Set<string>();

export const WINDOWS_SANDBOX_CAPABILITIES: SandboxCapabilities = {
  platform: 'win32', shellKind: 'powershell', workspaceEffectObservation: false,
  fileReadBoundary: true, fileWriteBoundary: true, environmentIsolation: true,
  networkIsolation: true, processTreeTermination: true, timeLimit: true,
  outputLimit: true, processCountLimit: true, cpuLimit: false, memoryLimit: false,
};

export const WINDOWS_UNRESTRICTED_CAPABILITIES: SandboxCapabilities = {
  ...WINDOWS_SANDBOX_CAPABILITIES,
  fileReadBoundary: false,
  fileWriteBoundary: false,
  networkIsolation: false,
};

export function createWindowsSandboxProcess(input: {
  readonly workspaceRoot: string;
  readonly maxProcessCount?: number;
  readonly isolation?: 'restricted' | 'unrestricted';
}): SandboxProcess {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const maxProcessCount = input.maxProcessCount ?? 16;
  const isolation = input.isolation ?? 'restricted';
  return {
    shellKind: 'powershell',
    shellName: isolation === 'restricted'
      ? 'Windows PowerShell 5.1 (AppContainer)'
      : 'Windows PowerShell 5.1',
    executionMethod: 'shell',
    async run(request, options) {
      options.signal.throwIfAborted();
      const canonicalRoot = await fs.realpath(workspaceRoot);
      const canonicalCwd = await fs.realpath(request.cwd);
      if (isolation === 'restricted' && !inside(canonicalRoot, canonicalCwd)) {
        throw new SandboxProcessError('sandbox_denied', 'Command cwd is outside the active Workspace.');
      }
      const helper = await ensureWindowsLauncher();
      const drive = isolation === 'restricted' ? await reserveDriveLetter() : '-';
      const relativeCwd = path.relative(canonicalRoot, canonicalCwd);
      const mappedCwd = relativeCwd === '' ? `${drive}\\` : `${drive}\\${relativeCwd}`;
      const command = isolation === 'restricted'
        ? request.command.replaceAll(canonicalRoot, `${drive}\\`)
        : request.command;
      const scopeTemp = isolation === 'restricted'
        ? path.join(canonicalRoot, '.megumi', 'sandbox-tmp', randomUUID())
        : await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-process-'));
      await fs.mkdir(scopeTemp, { recursive: true });
      const windowsRoot = process.env.SystemRoot ?? 'C:\\Windows';
      const executable = path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const args = [
        '--isolation', isolation,
        '--workspace', canonicalRoot,
        '--cwd', canonicalCwd,
        '--drive', drive,
        '--max-processes', String(maxProcessCount),
        executable,
        '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference = 'Continue'; Set-Location -LiteralPath '${(isolation === 'restricted' ? mappedCwd : canonicalCwd).replaceAll("'", "''")}'; ${command}`,
      ];
      try {
        return await runLauncher({ helper, args, cwd: canonicalCwd, temp: scopeTemp, options });
      } finally {
        if (isolation === 'restricted') reservedDriveLetters.delete(drive);
        await fs.rm(scopeTemp, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

async function reserveDriveLetter(): Promise<string> {
  for (let code = 'Z'.charCodeAt(0); code >= 'P'.charCodeAt(0); code -= 1) {
    const drive = `${String.fromCharCode(code)}:`;
    if (reservedDriveLetters.has(drive)) continue;
    try { await fs.access(`${drive}\\`); continue; } catch { /* Unmapped drive. */ }
    reservedDriveLetters.add(drive);
    return drive;
  }
  throw new SandboxProcessError('sandbox_unavailable', 'No temporary drive letter is available for the Windows Sandbox.');
}

async function ensureWindowsLauncher(): Promise<string> {
  helperPromise ??= compileWindowsLauncher();
  return helperPromise;
}

async function compileWindowsLauncher(): Promise<string> {
  if (process.platform !== 'win32') throw new SandboxProcessError('sandbox_unavailable', 'Windows process isolation is unavailable on this platform.');
  const version = createHash('sha256').update(WINDOWS_JOB_LAUNCHER_SOURCE).digest('hex').slice(0, 16);
  const directory = path.join(os.tmpdir(), 'megumi-sandbox-launcher', version);
  const executablePath = path.join(directory, 'MegumiSandboxLauncher.exe');
  await fs.mkdir(directory, { recursive: true });
  try { await fs.access(executablePath); return executablePath; } catch { /* compile below */ }
  const compilationId = randomUUID();
  const sourcePath = path.join(directory, `MegumiSandboxLauncher.${compilationId}.cs`);
  const temporaryExecutablePath = path.join(directory, `MegumiSandboxLauncher.${compilationId}.exe`);
  try {
    await fs.writeFile(sourcePath, WINDOWS_JOB_LAUNCHER_SOURCE, 'utf8');
    const escapedSource = sourcePath.replaceAll("'", "''");
    const escapedOutput = temporaryExecutablePath.replaceAll("'", "''");
    await runTrustedPowerShell(`Add-Type -Path '${escapedSource}' -OutputAssembly '${escapedOutput}' -OutputType ConsoleApplication`);
    try {
      await fs.rename(temporaryExecutablePath, executablePath);
    } catch {
      try { await fs.access(executablePath); }
      catch { throw new SandboxProcessError('sandbox_unavailable', 'Windows process launcher compilation produced no executable.'); }
    }
    return executablePath;
  } finally {
    await fs.rm(sourcePath, { force: true }).catch(() => undefined);
    await fs.rm(temporaryExecutablePath, { force: true }).catch(() => undefined);
  }
}

function runTrustedPowerShell(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { if (stderr.length < 16_000) stderr += String(chunk); });
    child.once('error', () => reject(new SandboxProcessError('sandbox_unavailable', 'Windows process launcher could not be compiled.')));
    child.once('close', (code) => code === 0 ? resolve() : reject(new SandboxProcessError('sandbox_unavailable', `Windows process launcher compilation failed: ${stderr.trim()}`)));
  });
}

function runLauncher(input: {
  readonly helper: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly temp: string;
  readonly options: { readonly signal: AbortSignal; readonly onStdout: (chunk: Uint8Array | string) => void; readonly onStderr: (chunk: Uint8Array | string) => void };
}): Promise<{ readonly exitCode: number; readonly terminationConfirmed: true }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.helper, input.args, {
      cwd: input.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: sanitizedEnvironment(input.temp),
    });
    let stderr = '';
    let settled = false;
    const abort = () => {
      if (child.exitCode === null && !child.kill()) {
        settled = true;
        reject(new SandboxProcessError('termination_unconfirmed', 'The Sandbox process tree could not be terminated.'));
      }
    };
    input.options.signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', input.options.onStdout);
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 64_000) stderr += String(chunk);
      input.options.onStderr(chunk);
    });
    child.once('error', () => {
      if (settled) return;
      settled = true;
      reject(new SandboxProcessError('sandbox_unavailable', 'The Windows process launcher could not start.'));
    });
    child.once('close', (code) => {
      input.options.signal.removeEventListener('abort', abort);
      if (settled) return;
      settled = true;
      if (input.options.signal.aborted) {
        reject(new SandboxProcessError('tool_cancelled', 'Command execution was cancelled and its process tree was terminated.'));
        return;
      }
      const helperError = parseHelperError(stderr);
      if (helperError) {
        reject(new SandboxProcessError(helperError.code === 'SANDBOX_SETUP_FAILED' ? 'sandbox_unavailable' : 'sandbox_denied', helperError.message));
        return;
      }
      resolve({ exitCode: code ?? -1, terminationConfirmed: true });
    });
  });
}

function sanitizedEnvironment(temp: string): NodeJS.ProcessEnv {
  const names = [
    'SystemRoot', 'WINDIR', 'SystemDrive', 'COMSPEC', 'PATHEXT', 'PATH',
    'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
    'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA', 'ProgramData',
    'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles',
  ];
  const env: NodeJS.ProcessEnv = { TEMP: temp, TMP: temp };
  for (const name of names) if (process.env[name]) env[name] = process.env[name];
  return env;
}

function parseHelperError(stderr: string): { readonly code: string; readonly message: string } | undefined {
  const line = stderr.split(/\r?\n/u).find((value) => value.startsWith(HELPER_ERROR_PREFIX));
  if (!line) return undefined;
  try { return JSON.parse(line.slice(HELPER_ERROR_PREFIX.length)) as { readonly code: string; readonly message: string }; }
  catch { return { code: 'SANDBOX_SETUP_FAILED', message: 'The Windows process launcher returned an invalid failure.' }; }
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}