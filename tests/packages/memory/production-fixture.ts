/* Real memory storage and Agent with responses replaced only at the model boundary. */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@megumi/ai';
import { createMemory } from '@megumi/application/memory/memory';
import { createMemoryFiles } from '@megumi/application/memory/memory-files';
import { createMemorySources } from '@megumi/application/coding/sessions/memory-sources';
import { createMemoryExtraction } from '@megumi/application/memory/extraction';
import { createSettings } from '@megumi/application/settings/settings-store';
import { selectConsolidationSources } from '@megumi/application/memory/consolidation-selection';
import { sourceMarker, EMPTY_MEMORY, EMPTY_SUMMARY } from '@megumi/application/memory/consolidation-documents';
import { createSourceFixture } from './source-fixture';
import type { Observability } from '@megumi/application/observability/index';

export function productionFixture(observability?: Observability) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'memory-production-'));
  const f = createSourceFixture(path.join(root, 'memory.db'));
  let now = Date.parse('2026-10-08T12:00:00Z');
  const settings = createSettings({ globalSettingsPath: path.join(root, 'settings.json'), credentialsPath: path.join(root, 'credentials.json'), readEnvironment: () => undefined });
  const initial = settings.readSettings();
  if (initial.status !== 'ok') throw new Error('Settings missing');
  settings.updateSettings({ expectedRevision: initial.settings.revision, patch: { memory: {
    extractModel: { providerId: 'faux', modelId: 'faux-1' }, consolidationModel: { providerId: 'faux', modelId: 'faux-1' },
  } } });
  const config = () => { const read = settings.readSettings(); if (read.status !== 'ok') throw new Error('Bad settings'); return read.settings.config.memory; };
  const ai = createModels(); const provider = fauxProvider(); ai.setProvider(provider.provider); const model = ai.getModels()[0];
  const files = createMemoryFiles(path.join(root, 'memories'));
  const sources = createMemorySources({ store: f.store, isSessionRunning: () => false });
  const extraction = createMemoryExtraction({ database: f.database, sources, observability, readConfiguration: config, workspaceDirectory: () => 'C:/memory-test', now: () => now,
    resolveModel: async () => ({ model, secrets: [], complete: async () => fauxAssistantMessage(JSON.stringify({ rawMemory: 'Use TypeScript for React examples.', rolloutSummary: 'User prefers TypeScript.', rolloutSlug: 'react' })) }) });
  const options = { database: f.database, settings, files, sources, extraction, observability, root: path.join(root, 'memories'), now: () => now, resolveModel: async () => ({ model, ai }) };
  const memory = createMemory(options);
  const tool = (name: string, args: Record<string, unknown>) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' });
  function responses() {
    provider.setResponses([
      () => tool('memory_file', { action: 'read', path: 'raw_memories.md' }),
      () => {
        const chosen = selectConsolidationSources({ database: f.database, sources, configuration: config(), now });
        const source = chosen.selected[0];
        const content = source ? `# Task Group: React\nscope: learning\napplies_to: workspace=w1\n## Task: Examples\n### rollout_summary_files\n- ${source.artifactPath} ${sourceMarker(source)}\n### keywords\n- TypeScript\n### learnings\n- Use TypeScript for React examples.\n` : EMPTY_MEMORY;
        return tool('memory_file', { action: 'write', path: 'MEMORY.md', expectedVersion: files.read('MEMORY.md')?.version ?? 'absent', content });
      },
      () => {
        const chosen = selectConsolidationSources({ database: f.database, sources, configuration: config(), now });
        const source = chosen.selected[0];
        const content = source ? `# User Profile\nPrefers TypeScript. ${sourceMarker(source)}\n\n# General Tips\nUse TS examples. ${sourceMarker(source)}\n\n# What's in Memory\n## 2026-10-02\nMEMORY.md: React examples. ${sourceMarker(source)}\n` : EMPTY_SUMMARY;
        return tool('memory_file', { action: 'write', path: 'memory_summary.md', expectedVersion: files.read('memory_summary.md')?.version ?? 'absent', content });
      },
      () => tool('memory_finish', {}),
    ]);
  }
  async function generate(requestId = 'first') {
    const start = memory.startGeneration({ requestId, reason: 'manual' });
    if (start.status !== 'started' && start.status !== 'reused') throw new Error(JSON.stringify(start));
    const waited = await memory.waitRun({ runId: start.runId, timeoutMs: 5000 });
    if (waited.status !== 'completed') throw new Error(JSON.stringify(waited));
    return waited.run;
  }
  return { ...f, root, memory, options, files, sources, provider, config, settings, tool, responses, generate,
    advance: (ms: number) => { now += ms; },
    async dispose() { await memory.shutdown(); f.database.close(); rmSync(root, { recursive: true, force: true }); },
  };
}
