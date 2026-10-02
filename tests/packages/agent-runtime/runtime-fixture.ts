import { createSettings } from '@megumi/application/settings/settings-store';
/* Assembles the real runtime over isolated SQLite and filesystem storage. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createModels, createProvider } from '@megumi/ai';
import { openAICompletionsApi } from '@megumi/ai/api/openai-completions.lazy';
import { createAgentRuntime } from '@megumi/agent-runtime/agent-runtime';
import { createContext } from '@megumi/agent-runtime/context/index';
import { createInputProcessor } from '@megumi/agent-runtime/runs/input/index';
import { createCommands, createCommandInputInterpreter } from '@megumi/agent-runtime/runs/commands/index';
import { createSessionHistory, createSessionBranchDrafts, createSessionAttachmentReader } from '@megumi/agent-runtime/sessions/index';
import { createPermissions, type PermissionRule } from '@megumi/agent-runtime/permissions/index';
import { createWorkspacePathPolicy } from '@megumi/agent-runtime/permissions/workspace-path-policy';
import { createTools } from '@megumi/agent-runtime/tools/index';
import { createSandbox } from '@megumi/agent-runtime/tools/sandbox/index';
import { createSessionAttachmentFileStore } from '@megumi/application/storage/session-attachment-store';
import { createDiscoveryRepository, createRecommendationAttempts, createCandidateSupplyAttempts, createDiscoveryFactsReader } from '@megumi/application/discovery/index';
import { createWorkspaceChanges } from '@megumi/application/workspace/index';
import { createWorkspaceStore } from '@megumi/application/workspace/workspace-store';
import { createContextFixture, contextModel } from '../context/context-behavior-fixture';
import { executionPolicy } from '../execution/execution-test-fixtures';

/** Uses production collaborators; only network and optional file-write timing are controlled externally. */
export async function createRuntimeFixture(options: { now?: () => string; beforeAttachmentWrite?: () => Promise<void>; beforeImageRead?: () => Promise<void> } = {}) {
  const fixture = await createContextFixture();
  const now = options.now ?? (() => new Date().toISOString());
  try {
  const repository = createDiscoveryRepository({ database: fixture.database, clock: { now } });
  const recommendationAttempts = createRecommendationAttempts();
  const candidateSupplyAttempts = createCandidateSupplyAttempts();
  const discoveryFacts = createDiscoveryFactsReader({ repository, recommendationAttempts, candidateSupplyAttempts });
  const model = { ...contextModel, api: 'openai-completions' as const };
  const globalSettingsPath = path.join(fixture.root, 'settings.json');
  const credentialsPath = path.join(fixture.root, 'credentials.json');
  await writeFile(globalSettingsPath, JSON.stringify({ models: {
    defaultModel: { providerId: model.provider, modelId: model.id },
    providers: { [model.provider]: { api: model.api, baseUrl: model.baseUrl } },
    customModels: { [model.provider]: { [model.id]: { contextWindowTokens: model.contextWindow, maxOutputTokens: model.maxTokens, capabilities: { imageInput: true } } } },
  } }));
  await writeFile(credentialsPath, JSON.stringify({ providers: { [model.provider]: 'test' } }));
  const settings = createSettings({ globalSettingsPath, credentialsPath, readEnvironment: () => undefined });
  const contentStore = createSessionAttachmentFileStore({
    attachmentsPath: path.join(fixture.root, 'runtime-attachments'),
    fileSystem: {
      ensureDirectory: async directory => { await mkdir(directory, { recursive: true }); },
      async writeFile(filename, bytes) { await options.beforeAttachmentWrite?.(); await writeFile(filename, bytes); },
      moveFile: rename, readFile, removeFile: filename => rm(filename, { force: true }),
    },
  });
  const history = createSessionHistory({ store: fixture.store, attachmentContentStore: contentStore });
  const context = createContext({
    ...fixture.options, sessionHistory: history, discoveryFactsReader: discoveryFacts,
    attachmentReader: createSessionAttachmentReader({ store: fixture.store, contentStore }),
  });
  const workspaceStore = createWorkspaceStore({ database: fixture.database });
  const workspaceChanges = createWorkspaceChanges({ store: workspaceStore });
  const tools = createTools({
    settings: { resolveWebSearch: () => ({ status: 'failed' }), readWebSearchApiKey: () => ({ status: 'missing' }) },
    workspaces: fixture.workspaceCatalog,
    workspaceChanges,
    recommendationTools: recommendationAttempts,
    candidateSupplyTools: candidateSupplyAttempts,
    sandbox: createSandbox(),
    executionPolicy: { maxExecutionTimeMs: 1000, maxOutputBytes: 20000, maxProcessCount: 4 },
  });
  const pathPolicy = createWorkspacePathPolicy();
  const rules: PermissionRule[] = [];
  const permissions = createPermissions({
    ruleReader: { resolvePermissionRules: () => ({ status: 'resolved', permissionSettings: { mode: 'ask', allow: rules, ask: [], deny: [] } }) },
    ruleWriter: { recordSessionPermissionGrant(request) { rules.push(...request.rules); return { status: 'saved' }; } },
    workspacePathClassifier: {
      classifyWorkspacePath(request) {
        const found = pathPolicy.classifyPath({ workspace_root: fixture.workspaceRoot, target_path: request.targetPath });
        return { status: 'classified', workspacePath: {
          absolutePath: found.absolute_path, workspacePath: found.workspace_path,
          insideWorkspace: found.inside_workspace, protected: found.protected, sensitive: found.sensitive,
        } };
      },
    },
  });
  const commands = createCommands({ compact: request => context.compact({ ...request, trigger: 'manual', tools: [] }) });
  const input = createInputProcessor({
    sourceAccess: {
      async readImage(source) { await options.beforeImageRead?.(); return readFile(source.type === 'local_file' ? source.path : source.referenceId); },
      async resolveDocument(source) { return { path: source.referenceId, sizeBytes: (await stat(source.referenceId)).size }; },
    },
    interpreters: [createCommandInputInterpreter(commands)],
  });
  const runtime = createAgentRuntime({
    modelResolution: () => ({ settings }),
    execution: {
      context, tools, permissions, session: history, events: fixture.events,
      clock: { now }, policy: executionPolicy,
      ids: { createModelCallId: randomUUID, createToolExecutionId: randomUUID, createApprovalId: randomUUID, createSessionMessageId: randomUUID },
    },
    input: {
      input, sessions: fixture.catalog, history,
      branches: createSessionBranchDrafts({ events: fixture.events, entries: fixture.store }),
    },
    createRunId: randomUUID, terminalRetentionMs: 60000,
    finalizeRun(run) {
      if (run.kind === 'conversation' && run.workspaceId && run.sessionId) workspaceChanges.finalizeChangeSet({
        workspace_id: run.workspaceId, session_id: run.sessionId, execution_id: run.runId,
        finalized_at: new Date().toISOString(),
      });
    },
  });
  return { ...fixture, repository, recommendationAttempts, candidateSupplyAttempts, model, history, runtime, workspaceChanges, async cleanup() { await runtime.stop({ timeoutMs: 5000 }); fixture.cleanup(); } };
  } catch (error) { fixture.cleanup(); throw error; }
}
