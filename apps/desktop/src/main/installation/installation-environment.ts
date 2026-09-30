/* Reads the current-user NSIS identity without changing installation records. */
import childProcess from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import type { DesktopRuntimeLogger } from '../runtime-logger';

const RegistrationSchema = z.object({ AppId: z.string(), Version: z.string(), InstallLocation: z.string() });
export type UpdateSupportReason = 'development' | 'platform' | 'not_installed';

export class InstallationHomeConflictError extends Error {
  constructor(readonly homePath: string, readonly programPath: string) {
    super('Megumi Home 与程序目录不能相同或互相包含。');
    this.name = 'InstallationHomeConflictError';
  }
}

/** Resolves existing ancestors so a junction cannot hide a Home/program overlap. */
export function assertSeparateHome(homePath: string, programPath: string): void {
  const home = realDestination(homePath);
  const program = realDestination(programPath);
  if (contains(home, program) || contains(program, home)) {
    throw new InstallationHomeConflictError(homePath, programPath);
  }
}

function realDestination(destination: string): string {
  const absolute = path.resolve(destination);
  try {
    return fs.realpathSync(absolute);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    return path.join(realDestination(path.dirname(absolute)), path.basename(absolute));
  }
}

function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

/** Recognizes only the running executable's matching per-user NSIS installation. */
export function resolveUpdateSupport(request: {
  isPackaged: boolean; platform: string; arch: string; appId: string;
  version: string; executablePath: string; logger: DesktopRuntimeLogger;
}): UpdateSupportReason | undefined {
  if (!request.isPackaged) return 'development';
  if (request.platform !== 'win32' || request.arch !== 'x64') return 'platform';
  try {
    // Read JSON to avoid locale-dependent reg.exe table parsing.
    const script = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); `
      + `$r=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\${request.appId}' -ErrorAction Stop; `
      + `$r | Select-Object AppId,Version,InstallLocation | ConvertTo-Json -Compress`;
    const output = childProcess.execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows',
      'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
    const record = RegistrationSchema.parse(JSON.parse(output));
    if (record.AppId === request.appId && record.Version === request.version
      && path.resolve(record.InstallLocation, 'megumi.exe').toLowerCase() === path.resolve(request.executablePath).toLowerCase()) {
      return undefined;
    }
  } catch (error) {
    request.logger.warn('application_update_installation_unrecognized', { error: String(error) });
  }
  return 'not_installed';
}
