/*
 * Aggregates the product-facing Host interfaces consumed by UI, CLI, and web shells.
 * This is not an Electron IPC contract; desktop, CLI, or web hosts may call it.
 */
import type { ProductCapabilities } from './application-capabilities';
import type { ApprovalHost } from './approval-contracts';
import type { SessionHost } from './coding/session-contracts';
import type { ObservabilityHost } from './observability/observability-contracts';
import type { DiscoveryHost } from './recommendation/recommendation-contracts';
import type { Settings } from './settings/settings-store';
import type { SkillHost } from './skill-contracts';
import type { VoiceHost } from './voice/voice-contracts';
import type { WorkspaceHost } from './workspace/workspace-contracts';

export interface ApplicationOperations {
  workspace: WorkspaceHost;
  session: SessionHost;
  skill: SkillHost;
  settings: Settings;
  models: Pick<ProductCapabilities['models'], 'readModelCatalog'>;
  tools: ProductCapabilities['tools'];
  approval: ApprovalHost;
  observability: ObservabilityHost;
  voice: VoiceHost;
  discovery: DiscoveryHost;
}
