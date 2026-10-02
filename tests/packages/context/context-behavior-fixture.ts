import type { ModelClient } from '@megumi/agent-runtime';
/* Assembles Context with real Session, Instructions, Skills, and file storage. */
import { createDatabaseSkillAvailabilityStore } from '@megumi/application/storage/skill-availability-store';
import {
  type BuildContextRequest,
  type CompactContextRequest,
  type CreateContextOptions,
} from '@megumi/agent-runtime/context/index';
import { createEventBus } from '@megumi/agent-runtime/events';
import { createInstructionReader } from '@megumi/agent-runtime/resources/instructions/index';
import { createSessionAttachmentReader } from '@megumi/agent-runtime/sessions/index';
import { createSkills } from '@megumi/agent-runtime/resources/skills/index';
import { createSessionFixture, savedAt } from '../session/session-test-fixture';
import { completedMessage, model } from './context-test-fixtures';

export const contextModel = { ...model, contextWindow: 16_000, maxTokens: 512 };

/** Replaces only the external model service; all owner capabilities run normally. */
export async function createContextFixture(
  completeSimple: ModelClient['completeSimple'] = async () =>
    completedMessage('Earlier conversation summary'),
) {
  const storage = await createSessionFixture();
  const {
    root,
    store,
    history,
    database,
    workspaceId,
    workspaceRoot,
    sessionId,
    workspaceCatalog,
    contentStore,
  } = storage;
  const events = createEventBus();
  const options: CreateContextOptions = {
    sessionHistory: history,
    attachmentReader: createSessionAttachmentReader({ store, contentStore }),
    workspaceSource: {
      async readWorkspace(request) {
        const workspace = workspaceCatalog.getWorkspace({ workspace_id: request.workspaceId });
        if (workspace.status !== 'found') {
          return {
            status: 'failed',
            failure: { code: 'workspace_not_found', message: 'Missing workspace' },
          };
        }
        return {
          status: 'ok',
          workspaceRoot: workspace.workspace.root_path,
          environment: {
            workingDirectory: workspace.workspace.root_path,
            operatingSystem: process.platform,
            shell: 'powershell',
          },
        };
      },
    },
    instructionReader: createInstructionReader({ megumiHomePath: root }),
    skills: createSkills({
      homePath: root,
      availabilityStore: createDatabaseSkillAvailabilityStore(database),
      workspaceRootResolver: { resolveWorkspaceRoot: async () => workspaceRoot },
    }),
    events,
    policy: { enabled: true, reserveTokens: 1024, keepRecentTokens: 1, minimumRecentMessages: 3 },
    clock: { now: () => savedAt },
  };
  const request: CompactContextRequest = {
    client: { completeSimple },
    compactionThresholdRatio: 1 - 1024 / contextModel.contextWindow,
    sessionId,
    workspaceId,
    model: contextModel,
    trigger: 'manual',
    tools: [],
  };
  const buildRequest: BuildContextRequest = {
    currentMessages: [],
    modelCallContext: {
      modelCallId: 'current-call',
      tools: [],
      run: {
        kind: 'conversation',
        executionId: 'current-execution',
        sessionId,
        workspaceId,
        client: { completeSimple },
        compactionThresholdRatio: 1 - 1024 / contextModel.contextWindow,
        model: contextModel,
        userInput: { displayContent: [], modelContent: [], attachments: [] },
      },
    },
  };
  return { ...storage, options, events, request, buildRequest };
}
