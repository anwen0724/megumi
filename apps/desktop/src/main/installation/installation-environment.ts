/* Reads the current-user NSIS identity without changing installation records. */
import childProcess from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import type { DesktopRuntimeLogger } from '../runtime-logger';

const RegistrationSchema = z.object({ AppId: z.string(), Version: z.string(), InstallLocation: z.string() });
export type UpdateSupportReason = 'development' | 'platform' | 'not_installed';

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
