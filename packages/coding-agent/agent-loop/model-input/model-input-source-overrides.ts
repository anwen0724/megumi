// Owns runtime source overrides used while building model input for an agent loop.
import type { SessionInstructionSourceSnapshot } from '@megumi/shared/model';

import type { AgentLoopInitialModelInputSourceOverrideProvider } from '../initial-input/initial-model-input-preparation';
import type { BuildModelCallInputInput } from './model-call-input-builder';

export interface ModelInputGlobalInstructionDirectoryProvider {
  listGlobalInstructionDirs(input: { sessionId: string; runId: string; stepId: string }): string[];
}

export interface ModelInputSessionInstructionSourceProvider {
  listSessionInstructionSources(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    builtAt: string;
  }): SessionInstructionSourceSnapshot[];
}

export interface ModelInputEffectiveCwdProvider {
  getRunEffectiveCwd(input: { sessionId: string; runId: string; stepId: string }): string | undefined;
}

export interface ModelInputSourceOverrideServiceOptions {
  globalInstructionDirectoryProvider?: ModelInputGlobalInstructionDirectoryProvider;
  sessionInstructionSourceProvider?: ModelInputSessionInstructionSourceProvider;
  effectiveCwdProvider?: ModelInputEffectiveCwdProvider;
}

export class ModelInputSourceOverrideService implements AgentLoopInitialModelInputSourceOverrideProvider {
  constructor(private readonly options: ModelInputSourceOverrideServiceOptions = {}) {}

  resolveModelInputSourceOverrides(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    builtAt: string;
  }): Partial<Pick<
    BuildModelCallInputInput,
    'globalInstructionDirs' | 'sessionInstructionSources' | 'requestedCwd'
  >> {
    const globalInstructionDirs = this.options.globalInstructionDirectoryProvider?.listGlobalInstructionDirs(input) ?? [];
    const sessionInstructionSources = this.options.sessionInstructionSourceProvider?.listSessionInstructionSources(input) ?? [];
    const requestedCwd = this.options.effectiveCwdProvider?.getRunEffectiveCwd(input);
    return {
      ...(globalInstructionDirs.length > 0 ? { globalInstructionDirs } : {}),
      ...(sessionInstructionSources.length > 0 ? { sessionInstructionSources } : {}),
      ...(requestedCwd ? { requestedCwd } : {}),
    };
  }
}
