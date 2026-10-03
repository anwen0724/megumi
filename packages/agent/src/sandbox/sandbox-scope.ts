/* Opens bounded execution scopes, selects a platform backend and awaits scope cleanup. */
import process from 'node:process';
import { createNodeSandboxFileAccess, type SandboxFileAccess } from './file-access';
import { createWindowsSandboxBackend, SandboxProcessError, type SandboxProcess } from './windows-process';

/* Defines the access facts selected by Permissions and enforced by one Sandbox scope. */

export type ToolExecutionFileAccess =
  | { readonly mode: 'workspace' }
  | {
      readonly mode: 'workspace_and_paths';
      readonly readablePaths: readonly string[];
      readonly writablePaths: readonly string[];
    }
  | { readonly mode: 'unrestricted' };

export interface ToolExecutionAccess {
  readonly fileSystem: ToolExecutionFileAccess;
  readonly process: 'sandboxed' | 'unrestricted';
  readonly network: 'denied' | 'unrestricted';
}

/* Defines execution-isolation policy, capability disclosure, and scope lifecycle. */

export interface SandboxCapabilities {
  readonly platform: NodeJS.Platform;
  readonly shellKind?: 'powershell' | 'cmd' | 'posix_shell';
  readonly shellName?: string;
  readonly workspaceEffectObservation: boolean;
  readonly fileReadBoundary: boolean;
  readonly fileWriteBoundary: boolean;
  readonly environmentIsolation: boolean;
  readonly networkIsolation: boolean;
  readonly processTreeTermination: boolean;
  readonly timeLimit: boolean;
  readonly outputLimit: boolean;
  readonly processCountLimit: boolean;
  readonly cpuLimit: boolean;
  readonly memoryLimit: boolean;
}

export interface SandboxPolicy {
  readonly workspaceRoot: string;
  readonly executionAccess: ToolExecutionAccess;
  readonly maxExecutionTimeMs: number;
  readonly maxOutputBytes: number;
  readonly maxProcessCount: number;
  readonly maxCpuTimeMs?: number;
  readonly maxMemoryBytes?: number;
}

export interface OpenSandboxRequest {
  readonly policy: SandboxPolicy;
  readonly signal?: AbortSignal;
}

export type OpenSandboxResult =
  | { readonly status: 'opened'; readonly scope: SandboxScope }
  | { readonly status: 'unavailable'; readonly reason: string };

export interface SandboxScope {
  readonly capabilities: SandboxCapabilities;
  readonly files: SandboxFileAccess;
  readonly process: SandboxProcess;
  close(): Promise<{ readonly status: 'closed' | 'termination_unconfirmed' }>;
}

export interface Sandbox {
  capabilities(): SandboxCapabilities;
  open(request: OpenSandboxRequest): Promise<OpenSandboxResult>;
}

/* Defines the platform seam used by the generic Sandbox and resolves its implementation. */

export interface SandboxBackendCapabilitiesRequest {
  readonly executionAccess: ToolExecutionAccess;
}

export interface CreateSandboxBackendProcessRequest {
  readonly workspaceRoot: string;
  readonly executionAccess: ToolExecutionAccess;
  readonly maxProcessCount: number;
}

export interface SandboxBackend {
  readonly platform: NodeJS.Platform;
  capabilities(request: SandboxBackendCapabilitiesRequest): SandboxCapabilities;
  createProcess(request: CreateSandboxBackendProcessRequest): SandboxProcess;
}

export function resolveSandboxBackend(
  input: { readonly platform?: NodeJS.Platform } = {},
): SandboxBackend {
  const platform = input.platform ?? process.platform;
  return platform === 'win32'
    ? createWindowsSandboxBackend()
    : createUnsupportedSandboxBackend({ platform });
}

export function createUnsupportedSandboxBackend(input: {
  readonly platform: NodeJS.Platform;
}): SandboxBackend {
  return {
    platform: input.platform,
    capabilities: () => ({
      platform: input.platform,
      shellKind: undefined,
      shellName: undefined,
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
    }),
    createProcess: () => unavailableProcess(input.platform),
  };
}

function unavailableProcess(platform: NodeJS.Platform): SandboxProcess {
  return {
    shellKind: 'posix_shell',
    shellName: 'Unavailable shell',
    executionMethod: 'shell',
    async run() {
      throw new SandboxProcessError(
        'sandbox_unavailable',
        `No process Sandbox Backend is implemented for ${platform}.`,
      );
    },
  };
}

/* Opens one bounded Sandbox scope through the selected platform Backend. */

const DEFAULT_EXECUTION_ACCESS = {
  fileSystem: { mode: 'workspace' as const },
  process: 'sandboxed' as const,
  network: 'denied' as const,
};

export function createSandbox(): Sandbox {
  return createSandboxWithBackend(resolveSandboxBackend());
}

export function createSandboxWithBackend(backend: SandboxBackend): Sandbox {
  return {
    capabilities: () => ({
      ...backend.capabilities({ executionAccess: DEFAULT_EXECUTION_ACCESS }),
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
          backend.capabilities({ executionAccess: request.policy.executionAccess }),
          backend.createProcess(backendRequest),
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
  let terminationUnconfirmed = false;
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
        if (error instanceof SandboxProcessError && error.code === 'termination_unconfirmed') {
          terminationUnconfirmed = true;
          throw error;
        }
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
      if (closed) return { status: terminationUnconfirmed ? 'termination_unconfirmed' : 'closed' };
      closed = true;
      scopeController.abort(new Error('Sandbox scope closed'));
      await Promise.allSettled([...active]);
      return terminationUnconfirmed
        ? { status: 'termination_unconfirmed' }
        : { status: 'closed' };
    },
  };
}
