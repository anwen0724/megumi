/* Runs an unrestricted POSIX shell in a killable process group with a redacted environment. */
import { spawn } from 'node:child_process';
import process from 'node:process';
import { SandboxProcessError, type SandboxProcess } from './sandbox-process';

export function createNodeUnrestrictedProcess(): SandboxProcess {
  return {
    shellKind: 'posix_shell',
    shellName: 'POSIX shell',
    executionMethod: 'shell',
    run(request, options) {
      options.signal.throwIfAborted();
      return new Promise((resolve, reject) => {
        const child = spawn(request.command, {
          cwd: request.cwd,
          shell: true,
          detached: true,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: sanitizedPosixEnvironment(),
        });
        let settled = false;
        let terminationUnconfirmed = false;
        const abort = () => {
          if (child.exitCode !== null || child.pid === undefined) return;
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            if (!child.kill('SIGKILL')) terminationUnconfirmed = true;
          }
        };
        options.signal.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', options.onStdout);
        child.stderr.on('data', options.onStderr);
        child.once('error', () => {
          if (settled) return;
          settled = true;
          options.signal.removeEventListener('abort', abort);
          reject(new SandboxProcessError('sandbox_unavailable', 'The local POSIX shell could not start.'));
        });
        child.once('close', (code) => {
          options.signal.removeEventListener('abort', abort);
          if (settled) return;
          settled = true;
          if (terminationUnconfirmed) {
            reject(new SandboxProcessError('termination_unconfirmed', 'The local process group could not be terminated.'));
          } else if (options.signal.aborted) {
            reject(new SandboxProcessError('tool_cancelled', 'Command execution was cancelled and its process group was terminated.'));
          } else {
            resolve({ exitCode: code ?? -1, terminationConfirmed: true });
          }
        });
      });
    },
  };
}

function sanitizedPosixEnvironment(): NodeJS.ProcessEnv {
  const names = [
    'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
    'TMPDIR', 'TMP', 'TEMP', 'TERM',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const name of names) if (process.env[name]) env[name] = process.env[name];
  return env;
}