/* Builds the Coding context from real session, instruction and Skill storage. */
import type { Models } from '@megumi/ai';
import { contextBudget, type AgentConfig } from '@megumi/agent';
import { PRODUCT_EXECUTION_POLICY } from '@megumi/application/application-policy';
import { createEventBus } from '@megumi/application/coding/events/event-bus';
import { createSkills } from '@megumi/application/skills/manage-skills';
import { createDatabaseSkillAvailabilityStore } from '@megumi/application/storage/skill-availability-store';
import { createSessionAttachmentReader } from '@megumi/application/coding/sessions/session-attachments';
import { createCodingContext, type CodingContextOptions } from '@megumi/application/coding/prepare-context';
import { createSessionFixture } from '../session/session-test-fixture';
import { completedMessage, model } from './context-test-fixtures';

export const contextModel = { ...model, contextWindow: 100_000, maxTokens: 1024 };

export async function createContextFixture(
  completeSimple: Models['completeSimple'] = async () => completedMessage('Earlier conversation summary'),
) {
  const storage = await createSessionFixture();
  const events = createEventBus();
  const config: AgentConfig & { environment: NonNullable<AgentConfig['environment']> } = {
    model: contextModel, tools: [], policy: PRODUCT_EXECUTION_POLICY, permissionMode: 'ask',
    environment: { workingDirectory: storage.workspaceRoot, operatingSystem: 'Windows', shell: 'powershell' },
  };
  const options: CodingContextOptions = {
    config, sessionId: storage.sessionId, workspaceId: storage.workspaceId,
    history: storage.history,
    attachments: createSessionAttachmentReader({ store: storage.store, contentStore: storage.contentStore }),
    ai: { completeSimple }, megumiHomePath: storage.root, instructionDocuments: [],
    compactionThresholdRatio: 0.65, events,
    skills: createSkills({ homePath: storage.root, availabilityStore: createDatabaseSkillAvailabilityStore(storage.database),
      workspaceRootResolver: { resolveWorkspaceRoot: async () => storage.workspaceRoot } }),
  };
  const request = { options, trigger: 'manual' as const, signal: new AbortController().signal };
  const prepareRequest = { tools: [], runMessages: [], budget: contextBudget(contextModel), signal: request.signal };
  return { ...storage, options, events, request, prepareRequest, context: createCodingContext(options) };
}
