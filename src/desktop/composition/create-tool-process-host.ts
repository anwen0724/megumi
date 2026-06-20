// Adapts the desktop process host to the ToolProcessHost port used by tools.
import type { ToolProcessHost } from '../../tools';
import type { DesktopHostAdapters } from './create-host-adapters';

export function createToolProcessHost(hosts: DesktopHostAdapters): ToolProcessHost {
  return {
    runCommand(input) {
      return new Promise((resolve, reject) => {
        const child = hosts.processHost.spawn(input.command, {
          cwd: input.cwd,
          shell: true,
          env: input.envPolicy === 'none' ? {} : process.env,
        });
        let stdout = '';
        let stderr = '';
        const timer = input.timeoutMs ? setTimeout(() => child.kill(), input.timeoutMs) : undefined;
        child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
        child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
        child.on('error', reject);
        child.on('close', (exitCode) => {
          if (timer) clearTimeout(timer);
          resolve({ exitCode: exitCode ?? 0, stdout, stderr });
        });
      });
    },
  };
}
