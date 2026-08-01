/* Opens one bounded Sandbox scope through an injected platform Backend. */
import { createNodeSandboxFileAccess } from './node-sandbox';
import type { SandboxBackend } from './sandbox-backend';
import type { OpenSandboxRequest, Sandbox, SandboxCapabilities, SandboxScope } from './sandbox';
import { SandboxProcessError, type SandboxProcess } from './sandbox-process';

const DEFAULT_EXECUTION_ACCESS = {
  fileSystem: { mode: 'workspace' as const },
  process: 'sandboxed' as const,
  network: 'denied' as const,
};

export function createSandbox(input: { readonly backend: SandboxBackend }): Sandbox {
  return {
    capabilities: () => ({
      ...input.backend.capabilities({ executionAccess: DEFAULT_EXECUTION_ACCESS }),
    }),
    async open(request) {
      request.signal?.throwIfAborted();
      const backendRequest = {
        workspaceRoot: request.policy.workspaceRoot,
        executionAccess: request.policy.executionAccess,
        maxProcessCount: request.policy.maxProcessCount,
      };
      return {
        status: 'opened',
        scope: createScope(
          request,
          input.backend.capabilities({ executionAccess: request.policy.executionAccess }),
          input.backend.createProcess(backendRequest),
        ),
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
