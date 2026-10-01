/* Assembles Context with real Session, Instructions, Skills, and file storage. */
import { type BuildContextRequest, type CompactContextRequest, type CreateContextOptions } from '@megumi/context';
import { createEventBus } from '@megumi/events';
import { createInstructionReader } from '@megumi/instructions';
import { createSessionAttachmentReader } from '@megumi/session';
import { createSkills } from '@megumi/skills';
import { createSessionFixture, savedAt } from '../session/session-test-fixture';
import { completedMessage, model } from './context-test-fixtures';

export const contextModel = { ...model, contextWindow: 16_000, maxTokens: 512 };

/** Replaces only the external model service; all owner capabilities run normally. */
export async function createContextFixture(
  completeSimple: CreateContextOptions['models']['completeSimple'] = async () => completedMessage('Earlier conversation summary'),
) {
  const storage = await createSessionFixture();
  const { root, store, history, database, workspaceId, workspaceRoot, sessionId, workspaceCatalog, contentStore } = storage;
  const events = createEventBus();
  const options: CreateContextOptions = {
    sessionHistory: history,
    attachmentReader: createSessionAttachmentReader({ store, contentStore }),
    workspaceSource: {
      async readWorkspace(request) {
        const workspace = workspaceCatalog.getWorkspace({ workspace_id: request.workspaceId });
        if (workspace.status !== 'found') {
          return { status: 'failed', failure: { code: 'workspace_not_found', message: 'Missing workspace' } };
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
      database,
      workspaceRootResolver: { resolveWorkspaceRoot: async () => workspaceRoot },
    }),
    models: { completeSimple },
    events,
    policy: { enabled: true, reserveTokens: 1024, keepRecentTokens: 1, minimumRecentMessages: 3 },
    clock: { now: () => savedAt },
  };
  const request: CompactContextRequest = {
    sessionId, workspaceId, model: contextModel, trigger: 'manual', tools: [],
  };
  const buildRequest: BuildContextRequest = {
    currentMessages: [],
    modelCallContext: {
      modelCallId: 'current-call',
      tools: [],
      run: {
        kind: 'conversation', executionId: 'current-execution', sessionId, workspaceId,
        model: contextModel, userInput: { displayContent: [], modelContent: [], attachments: [] },
      },
    },
  };
  return { ...storage, options, events, request, buildRequest };
}
