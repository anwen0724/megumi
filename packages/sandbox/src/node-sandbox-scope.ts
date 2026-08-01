/* Opens one bounded Sandbox scope and converges all process executions on close. */
import process from 'node:process';
import { createNodeSandboxFileAccess } from './node-sandbox';
import type { OpenSandboxRequest, Sandbox, SandboxCapabilities, SandboxScope } from './sandbox';
import { SandboxProcessError, type SandboxProcess } from './sandbox-process';
import {
  createWindowsSandboxProcess,
  WINDOWS_SANDBOX_CAPABILITIES,
  WINDOWS_UNRESTRICTED_CAPABILITIES,
} from './windows-sandbox-process';

const PORTABLE_CAPABILITIES: SandboxCapabilities = {
  platform: 'linux',
  shellKind: 'posix_shell',
  workspaceEffectObservation: false,
  fileReadBoundary: true,
  fileWriteBoundary: true,
  environmentIsolation: false,
  networkIsolation: false,
  processTreeTermination: false,
  timeLimit: false,
  outputLimit: false,
  processCountLimit: false,
  cpuLimit: false,
  memoryLimit: false,
};

export function createNodeSandbox(input: { readonly platform?: NodeJS.Platform } = {}): Sandbox {
  const platform = input.platform ?? process.platform;
  const advertisedCapabilities = platform === 'win32'
    ? WINDOWS_SANDBOX_CAPABILITIES
    : { ...PORTABLE_CAPABILITIES, platform, shellKind: 'posix_shell' as const };
  return {
    capabilities: () => ({ ...advertisedCapabilities }),
    async open(request) {
      request.signal?.throwIfAborted();
      const isolation = request.policy.executionAccess.process === 'sandboxed'
        ? 'restricted' as const
        : 'unrestricted' as const;
      const capabilities = platform === 'win32'
        ? isolation === 'restricted'
          ? WINDOWS_SANDBOX_CAPABILITIES
          : WINDOWS_UNRESTRICTED_CAPABILITIES
        : advertisedCapabilities;
      const processAdapter = platform === 'win32'
        ? createWindowsSandboxProcess({
            workspaceRoot: request.policy.workspaceRoot,
            maxProcessCount: request.policy.maxProcessCount,
            isolation,
          })
        : unavailableProcess();
      return {
        status: 'opened',
        scope: createScope(request, capabilities, processAdapter),
      };
    },
  };
}

function createScope(
  request: OpenSandboxRequest,
  capabilities: SandboxCapabilities,
  processAdapter: SandboxProcess,
): SandboxScope {
  const scopeController = new AbortController();
  const active = new Set<Promise<unknown>>();
  let closed = false;
  const boundedProcess: SandboxProcess = {
    shellKind: processAdapter.shellKind,
    shellName: processAdapter.shellName,
    executionMethod: processAdapter.executionMethod,
    async run(processRequest, options) {
      if (closed) throw new SandboxProcessError('sandbox_denied', 'The Sandbox scope is closed.');
      const executionController = new AbortController();
      const signal = request.signal
        ? AbortSignal.any([request.signal, scopeController.signal, options.signal, executionController.signal])
        : AbortSignal.any([scopeController.signal, options.signal, executionController.signal]);
      let outputBytes = 0;
      let outputLimitReached = false;
      let timedOut = false;
      const forward = (stream: 'stdout' | 'stderr', chunk: Uint8Array | string) => {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
        const remaining = request.policy.maxOutputBytes - outputBytes;
        if (remaining > 0) {
          const captured = bytes.subarray(0, remaining);
          outputBytes += captured.byteLength;
          (stream === 'stdout' ? options.onStdout : options.onStderr)(captured);
        }
        if (bytes.byteLength > remaining) {
          outputLimitReached = true;
          executionController.abort(new Error('Sandbox output limit reached'));
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        executionController.abort(new Error('Sandbox execution time limit reached'));
      }, request.policy.maxExecutionTimeMs);
      const running = processAdapter.run(processRequest, {
        signal,
        onStdout: (chunk) => forward('stdout', chunk),
        onStderr: (chunk) => forward('stderr', chunk),
      });
      active.add(running);
      try {
        const result = await running;
        if (outputLimitReached) throw new SandboxProcessError('output_limit', 'Command output exceeded the Sandbox limit.');
        if (timedOut) throw new SandboxProcessError('tool_timeout', 'Command exceeded the Sandbox time limit.');
        return result;
      } catch (error) {
        if (outputLimitReached) throw new SandboxProcessError('output_limit', 'Command output exceeded the Sandbox limit.');
        if (timedOut) throw new SandboxProcessError('tool_timeout', 'Command exceeded the Sandbox time limit.');
        throw error;
      } finally {
        clearTimeout(timer);
        active.delete(running);
      }
    },
  };
  return {
    capabilities: { ...capabilities },
    files: createNodeSandboxFileAccess({
      workspaceRoot: request.policy.workspaceRoot,
      access: request.policy.executionAccess.fileSystem,
    }),
    process: boundedProcess,
    async close() {
      if (closed) return { status: 'closed' };
      closed = true;
      scopeController.abort(new Error('Sandbox scope closed'));
      const results = await Promise.allSettled([...active]);
      return results.some((result) => result.status === 'rejected'
        && result.reason instanceof SandboxProcessError
        && result.reason.code === 'termination_unconfirmed')
        ? { status: 'termination_unconfirmed' }
        : { status: 'closed' };
    },
  };
}

function unavailableProcess(): SandboxProcess {
  return {
    shellKind: 'posix_shell',
    shellName: 'Unavailable isolated shell',
    executionMethod: 'shell',
    async run() {
      throw new SandboxProcessError('sandbox_unavailable', 'No proven process Sandbox is available for this platform.');
    },
  };
}