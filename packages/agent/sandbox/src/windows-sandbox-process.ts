/* Runs Windows commands in either an AppContainer or an unrestricted bounded Job Object. */

import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs, { type FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SandboxProcessError, type SandboxProcess } from './sandbox-process';
import { WINDOWS_JOB_LAUNCHER_SOURCE } from './windows-job-launcher-source';

const HELPER_ERROR_PREFIX = 'MEGUMI_SANDBOX_ERROR:';
let helperPromise: Promise<string> | undefined;
const reservedDriveLetters = new Set<string>();

interface DriveReservation {
  readonly drive: string;
  release(): Promise<void>;
}

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
    shellName: 'Windows PowerShell',
    executionMethod: 'shell',
    async run(request, options) {
      options.signal.throwIfAborted();
      const canonicalRoot = await fs.realpath(workspaceRoot);
      const canonicalCwd = await fs.realpath(request.cwd);
      if (isolation === 'restricted' && !inside(canonicalRoot, canonicalCwd)) {
        throw new SandboxProcessError('sandbox_denied', 'Command cwd is outside the active Workspace.');
      }
      const powerShellExecutable = await resolveWindowsPowerShellExecutable();
      const helper = await ensureWindowsLauncher(powerShellExecutable);
      const driveReservation = isolation === 'restricted' ? await reserveDriveLetter() : undefined;
      let scopeTemp: string | undefined;
      try {
        const drive = driveReservation?.drive ?? '-';
        const relativeCwd = path.relative(canonicalRoot, canonicalCwd);
        const mappedCwd = relativeCwd === '' ? `${drive}\\` : `${drive}\\${relativeCwd}`;
        const command = isolation === 'restricted'
          ? request.command.replaceAll(canonicalRoot, `${drive}\\`)
          : request.command;
        scopeTemp = isolation === 'restricted'
          ? path.join(canonicalRoot, '.megumi', 'sandbox-tmp', randomUUID())
          : await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-process-'));
        await fs.mkdir(scopeTemp, { recursive: true });
        const args = [
          '--isolation', isolation,
          '--workspace', canonicalRoot,
          '--cwd', canonicalCwd,
          '--drive', drive,
          '--max-processes', String(maxProcessCount),
          powerShellExecutable,
          '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
          `$ErrorActionPreference = 'Continue'; Set-Location -LiteralPath '${(isolation === 'restricted' ? mappedCwd : canonicalCwd).replaceAll("'", "''")}'; ${command}`,
        ];
        return await runLauncher({ helper, args, cwd: canonicalCwd, temp: scopeTemp, options });
      } finally {
        await driveReservation?.release();
        if (scopeTemp) await fs.rm(scopeTemp, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

async function reserveDriveLetter(): Promise<DriveReservation> {
  const lockDirectory = path.join(os.tmpdir(), 'megumi-sandbox-drive-locks');
  await fs.mkdir(lockDirectory, { recursive: true });
  for (let code = 'Z'.charCodeAt(0); code >= 'P'.charCodeAt(0); code -= 1) {
    const drive = `${String.fromCharCode(code)}:`;
    if (reservedDriveLetters.has(drive)) continue;
    const lockPath = path.join(lockDirectory, `${drive[0]}.lock`);
    const lock = await acquireDriveLock(lockPath);
    if (!lock) continue;
    try {
      await fs.access(`${drive}\\`);
      await releaseDriveLock(lock, lockPath);
      continue;
    } catch { /* Unmapped drive. */ }
    reservedDriveLetters.add(drive);
    return {
      drive,
      async release() {
        reservedDriveLetters.delete(drive);
        await releaseDriveLock(lock, lockPath);
      },
    };
  }
  throw new SandboxProcessError('sandbox_unavailable', 'No temporary drive letter is available for the Windows Sandbox.');
}

async function acquireDriveLock(lockPath: string): Promise<FileHandle | undefined> {
  try {
    const lock = await fs.open(lockPath, 'wx');
    await lock.writeFile(String(process.pid), 'utf8');
    return lock;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const [ownerText, lockStats] = await Promise.all([
    fs.readFile(lockPath, 'utf8').catch(() => ''),
    fs.stat(lockPath).catch(() => undefined),
  ]);
  const owner = Number.parseInt(ownerText, 10);
  const lockIsBeingCreated = !Number.isSafeInteger(owner)
    && lockStats !== undefined
    && Date.now() - lockStats.mtimeMs < 60_000;
  if (lockIsBeingCreated || (Number.isSafeInteger(owner) && isProcessAlive(owner))) return undefined;
  await fs.rm(lockPath, { force: true }).catch(() => undefined);
  try {
    const lock = await fs.open(lockPath, 'wx');
    await lock.writeFile(String(process.pid), 'utf8');
    return lock;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined;
    throw error;
  }
}

async function releaseDriveLock(lock: FileHandle, lockPath: string): Promise<void> {
  await lock.close().catch(() => undefined);
  await fs.rm(lockPath, { force: true }).catch(() => undefined);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
async function resolveWindowsPowerShellExecutable(): Promise<string> {
  const windowsRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const executable = path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    await fs.access(executable);
    return executable;
  } catch {
    throw new SandboxProcessError('shell_unavailable', 'Windows PowerShell is unavailable.');
  }
}

async function ensureWindowsLauncher(powerShellExecutable: string): Promise<string> {
  helperPromise ??= compileWindowsLauncher(powerShellExecutable);
  return helperPromise;
}

async function compileWindowsLauncher(powerShellExecutable: string): Promise<string> {
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
    await runTrustedPowerShell(powerShellExecutable, `Add-Type -Path '${escapedSource}' -OutputAssembly '${escapedOutput}' -OutputType ConsoleApplication`);
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

function runTrustedPowerShell(powerShellExecutable: string, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(powerShellExecutable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
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