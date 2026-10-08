/* Exercises production, real Coding tools, reply saving and usage selection together. */
// @vitest-environment node
import { expect, it } from 'vitest';
import { stat, readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { createAgent, createSandbox, createWebFetch } from '@megumi/agent';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall } from '@megumi/ai';
import { createCoding } from '@megumi/application/coding/submit-message';
import { createSessionCatalog } from '@megumi/application/coding/sessions/session-catalog';
import { createSessionBranchDrafts } from '@megumi/application/coding/sessions/session-branches';
import { createEventBus } from '@megumi/application/coding/events/event-bus';
import { createInputProcessor } from '@megumi/application/coding/input/parse-message';
import { createWorkspaceCatalog } from '@megumi/application/workspace/index';
import { createWorkspaceStore } from '@megumi/application/workspace/workspace-store';
import { createWorkspaceChanges } from '@megumi/application/workspace/workspace-changes';
import { createSessionAttachmentReader } from '@megumi/application/coding/sessions/session-attachments';
import { createSessionAttachmentFileStore } from '@megumi/application/coding/sessions/session-storage';
import { PRODUCT_EXECUTION_POLICY } from '@megumi/application/application-policy';
import { productionFixture } from './production-fixture';
import type { MemoryCitation } from '@megumi/application/memory/memory-citations';

it('reuses generated history in another Coding session, saves verified citations, and survives disabled use', async () => {
  const f = productionFixture();
  const ai = createModels(); const provider = fauxProvider(); ai.setProvider(provider.provider);
  const events = createEventBus(); const store = createWorkspaceStore({ database: f.database });
  const workspaces = createWorkspaceCatalog({ store, file_system: { stat } });
  const opened = await workspaces.openWorkspace({ root_path: f.root });
  if (opened.status !== 'opened') throw new Error();
  const coding = createCoding({ ai, agent: createAgent({ ai }), memory: () => f.memory,
    sessions: createSessionCatalog({ store: f.store }), history: f.history,
    branches: createSessionBranchDrafts({ store: f.store, events }), input: createInputProcessor({ sourceAccess: {
      async readImage(source) { if (source.type !== 'local_file') throw new Error('No host image'); return readFile(source.path); },
      async resolveDocument(source) { return { path: source.referenceId, sizeBytes: (await stat(source.referenceId)).size }; },
    } }),
    preparation: { workspaces, workspaceChanges: createWorkspaceChanges({ store }), sandbox: createSandbox(),
      policy: PRODUCT_EXECUTION_POLICY, operatingSystem: 'Windows', webFetch: createWebFetch() },
    context: { megumiHomePath: f.root, instructionDocuments: [], attachments: createSessionAttachmentReader({ store: f.store,
      contentStore: createSessionAttachmentFileStore({ attachmentsPath: f.root + '/attachments', fileSystem: { ensureDirectory: async directory => { await mkdir(directory, { recursive: true }); }, writeFile, moveFile: rename, readFile, removeFile: filename => rm(filename, { force: true }) } }) }) },
    events, terminalRetentionMs: 0,
    resolveModel: async () => ({ status: 'ok', model: ai.getModels()[0], compactionThresholdRatio: 0.8 }),
    finalize: async () => {},
  });
  try {
    await f.user('u1'); f.responses(); await f.generate();
    let citations: MemoryCitation[] = [];
    provider.setResponses([
      context => {
        expect(JSON.stringify(context.messages.filter(message => message.role === 'system'))).toContain('Historical memory');
        expect(context.messages.some(message => message.role === 'system' && message.toolsAdded?.some(tool => tool.name === 'memory_read'))).toBe(true);
        return fauxAssistantMessage(fauxToolCall('memory_read', { path: 'MEMORY.md' }), { stopReason: 'toolUse' });
      },
      context => {
        const result = context.messages.filter(message => message.role === 'toolResult').at(-1);
        const body = result?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? '';
        const parsed = JSON.parse(body);
        expect(parsed.status).toBe('found');
        expect(parsed.document.content).toContain('Use TypeScript');
        citations = parsed.references;
        return fauxAssistantMessage(fauxToolCall('memory_source', { sourceRef: parsed.sourceRefs[0] }), { stopReason: 'toolUse' });
      },
      context => {
        const result = context.messages.filter(message => message.role === 'toolResult').at(-1);
        const text = result?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? '';
        expect(JSON.parse(text)).toMatchObject({ status: 'found', sessionId: 's1', messages: [{ messageId: 'u1' }] });
        return fauxAssistantMessage(`Here is a TypeScript example.\n<memory_citations>${JSON.stringify(citations)}</memory_citations>`);
      },
    ]);
    const start = await coding.submitInput({ workspaceId: opened.workspace.workspace_id, text: 'Show an example using my preferred language.', permissionMode: 'full_access' });
    if (start.status !== 'started') throw new Error(JSON.stringify(start));
    expect(await start.run.completion).toMatchObject({ status: 'completed' });
    expect(f.memory.listSources()).toMatchObject({ sources: expect.arrayContaining([expect.objectContaining({ sessionId: 's1', usageCount: 1 })]) });
    const replies = f.sources.listReplies({ afterCursor: 0, limit: 20 });
    expect(replies[0].message.memory_evidence?.reads.some(read => read.path === 'MEMORY.md')).toBe(true);
    f.store.insertSession({ session_id: 's2', workspace_id: 'w1', title: 'Unused source', status: 'active', created_at: '2026-10-01', updated_at: '2026-10-01' });
    await f.history.saveUserMessage({ session_id: 's2', message_id: 'u2', display_content: [{ type: 'text', text: 'Another preference' }], model_content: [{ type: 'text', text: 'Another preference' }], created_at: '2026-10-02T00:00:00Z' });
    await f.options.extraction.extract();
    const beforeSelection = f.settings.readSettings(); if (beforeSelection.status !== 'ok') throw new Error();
    f.settings.updateSettings({ expectedRevision: beforeSelection.settings.revision, patch: { memory: { maxConsolidationSources: 1 } } });
    // At equal source times s2 wins the ID tie; the saved use of s1 must keep s1 selected.
    f.responses();
    expect(await f.generate('selection-after-usage')).toMatchObject({ status: 'completed' });
    expect(f.memory.listSources()).toMatchObject({ sources: expect.arrayContaining([
      expect.objectContaining({ sessionId: 's1', selected: true }), expect.objectContaining({ sessionId: 's2', selected: false }),
    ]) });
    const settings = f.settings.readSettings(); if (settings.status !== 'ok') throw new Error();
    f.settings.updateSettings({ expectedRevision: settings.settings.revision, patch: { memory: { useMemories: false } } });
    provider.setResponses([context => {
      expect(JSON.stringify(context.messages.filter(message => message.role === 'system'))).not.toContain('Historical memory');
      expect(context.messages.some(message => message.role === 'system' && message.toolsAdded?.some(tool => tool.name.startsWith('memory_')))).toBe(false);
      return fauxAssistantMessage('Continue without automatic memory.');
    }]);
    const next = await coding.submitInput({ workspaceId: opened.workspace.workspace_id, sessionId: start.session.session_id, text: 'Continue.', permissionMode: 'full_access' });
    if (next.status !== 'started') throw new Error(JSON.stringify(next));
    expect(await next.run.completion).toMatchObject({ status: 'completed' });
  } finally { await coding.shutdown(); await f.dispose(); }
});
