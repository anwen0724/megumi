/*
 * Aggregates the product-facing Host interfaces consumed by UI, CLI, and web shells.
 * This is not an Electron IPC contract; desktop, CLI, or web hosts may call it.
 */
import type { ApprovalHost } from './approval-contracts';
import type { SessionHost } from './session-contracts';
import type { Settings } from './settings/settings-store';
import type { AgentRuntime } from '@megumi/agent-runtime/agent-runtime';
import type { Tools } from '@megumi/agent-runtime/tools';
import type { SkillHost } from './skill-contracts';
import type { WorkspaceHost } from './workspace/workspace-contracts';
import type { ObservabilityHost } from './observability/observability-contracts';
import type { VoiceHost } from './voice/voice-contracts';
import type { DiscoveryHost } from './discovery/discovery-contracts';

export interface ApplicationOperations {
  workspace: WorkspaceHost;
  session: SessionHost;
  skill: SkillHost;
  settings: Settings;
  models: Pick<AgentRuntime, 'readModelCatalog'>;
  tools: Pick<Tools, 'listAvailableTools'>;
  approval: ApprovalHost;
  observability: ObservabilityHost;
  voice: VoiceHost;
  discovery: DiscoveryHost;
}
