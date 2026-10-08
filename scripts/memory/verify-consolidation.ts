/* Explicit protocol probe: fictional learning history, isolated files, first generation and removal. */
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { fauxAssistantMessage } from '@megumi/ai';
import os from 'node:os';
import path from 'node:path';
import { createApplicationModels } from '../../packages/application/src/compose-modules';
import { createSettings } from '../../packages/application/src/settings/settings-store';
import { createDatabase, migrateDatabase } from '../../packages/application/src/storage/index';
import { createSessionStore } from '../../packages/application/src/coding/sessions/session-storage';
import { createSessionHistory } from '../../packages/application/src/coding/sessions/session-history';
import { createMemorySources } from '../../packages/application/src/coding/sessions/memory-sources';
import { createMemoryExtraction } from '../../packages/application/src/memory/extraction';
import { createMemoryFiles } from '../../packages/application/src/memory/memory-files';
import { createMemory } from '../../packages/application/src/memory/memory';
import {
  resolveExtractionModel,
  resolveConsolidationModel,
} from '../../packages/application/src/memory/extraction-model';
import {
  composeObservability,
  nodeObservabilityStorage,
} from '../../packages/application/src/observability/index';

async function main() {
  if (!process.argv.includes('--run')) throw new Error('Explicit --run authorization is required.');

  const home = process.env.MEGUMI_HOME ?? path.join(os.homedir(), '.megumi');
  const global = createSettings({
    globalSettingsPath: path.join(home, 'settings.json'),
    credentialsPath: path.join(home, 'credentials.json'),
    readEnvironment: name => process.env[name],
  });
  const read = global.readSettings();
  if (read.status !== 'ok' || !read.settings.config.general.lastSelectedModel)
    throw new Error('No configured default model.');

  const selectedModel = read.settings.config.general.lastSelectedModel;
  const parent = path.resolve('.tmp');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'memory-p3-protocol-'));
  const config = {
    ...read.settings.config,
    memory: {
      ...read.settings.config.memory,
      generateMemories: true,
      extractModel: selectedModel,
      consolidationModel: selectedModel,
    },
  };
  writeFileSync(path.join(root, 'settings.json'), JSON.stringify(config, null, 2));
  const isolated = createSettings({
    globalSettingsPath: path.join(root, 'settings.json'),
    credentialsPath: path.join(root, 'credentials.json'),
    readEnvironment: name => process.env[name],
  });
  const settings = {
    ...isolated,
    readCredential: global.readCredential,
  };
  const models = createApplicationModels({ settingsForWorkspace: () => settings });
  const database = createDatabase({ filename: path.join(root, 'memory.db') });
  migrateDatabase({ database });
  const trace = composeObservability({
    rootDirectory: path.join(root, 'observability'),
    storage: nodeObservabilityStorage,
  });
  const historical = new Date(Date.now() - 2 * 86400000).toISOString();
  database
    .prepare({ sql: 'INSERT INTO workspaces VALUES (?,?,?,?,?,?,?,?)' })
    .run([
      'synthetic',
      'Synthetic learning',
      'C:/synthetic-react',
      'c:/synthetic-react',
      'available',
      historical,
      historical,
      historical,
    ]);

  const store = createSessionStore({ database });
  store.insertSession({
    session_id: 'learning',
    workspace_id: 'synthetic',
    title: 'Synthetic conversation',
    status: 'active',
    created_at: historical,
    updated_at: historical,
  });

  const history = createSessionHistory({
    store,
    ids: { entryId: ({ source_id }) => `entry:${source_id}` },
  });
  const text =
    '这是虚构的 React/TypeScript 学习会话。我学习 React，后续代码示例请使用 TypeScript。解释 Hook 时，先展示一个最小可运行例子，再解释依赖数组；不要默认我熟悉闭包。';
  const reportIndex = process.argv.indexOf('--p2-report');
  const p2ReportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : undefined;
  const p2 = p2ReportPath ? JSON.parse(readFileSync(p2ReportPath, 'utf8')) : undefined;
  if (
    p2 &&
    (p2.scope !== 'synthetic-only' ||
      p2.samples?.find((sample: { id: string }) => sample.id === 'learning')?.text !== text)
  )
    throw new Error('P2 material is outside this probe scope.');

  const prior = p2?.outputs?.find(
    (output: { sample: string }) => output.sample === 'learning',
  )?.extraction;
  if (p2 && !prior?.rawMemory) throw new Error('The P2 extraction is empty.');

  const saved = await history.saveUserMessage({
    session_id: 'learning',
    message_id: 'user:learning',
    display_content: [
      {
        type: 'text',
        text,
      },
    ],
    model_content: [
      {
        type: 'text',
        text,
      },
    ],
    created_at: historical,
  });
  if (saved.status !== 'saved') throw new Error('Could not save synthetic source.');

  const sources = createMemorySources({
    store,
    isSessionRunning: () => false,
  });
  const files = createMemoryFiles(path.join(root, 'memories'));
  const extraction = createMemoryExtraction({
    database,
    sources,
    readConfiguration: () => config.memory,
    workspaceDirectory: () => 'C:/synthetic-react',
    observability: trace.observability,
    resolveModel: async selection => {
      const resolved = await resolveExtractionModel({
        models,
        settings,
        selection,
      });
      return prior
        ? {
            ...resolved,
            complete: async () =>
              fauxAssistantMessage(
                JSON.stringify({
                  rawMemory: prior.rawMemory,
                  rolloutSummary: prior.rolloutSummary,
                  rolloutSlug: prior.rolloutSlug,
                }),
              ),
          }
        : resolved;
    },
  });
  const memory = createMemory({
    database,
    settings,
    files,
    sources,
    extraction,
    root: path.join(root, 'memories'),
    observability: trace.observability,
    resolveModel: selection =>
      resolveConsolidationModel({
        models,
        settings,
        selection,
      }),
  });

  try {
    const startedAt = Date.now();
    const started = memory.startGeneration({
      requestId: 'synthetic-generation',
      reason: 'manual',
    });
    if (started.status !== 'started') throw new Error('Generation was not accepted.');

    async function wait(runId: string) {
      for (;;) {
        const result = await memory.waitRun({
          runId,
          timeoutMs: 60000,
        });
        if (result.status !== 'timeout') return result;
      }
    }

    const generated = await wait(started.runId);
    const firstDocuments = files.list();
    writeFileSync(
      path.join(root, 'first.json'),
      JSON.stringify(
        {
          generated,
          documents: firstDocuments,
        },
        null,
        2,
      ),
    );

    const removed = memory.setSourceEligibility({
      requestId: 'synthetic-removal',
      sessionId: 'learning',
      eligibility: 'excluded',
      expectedVersion: 0,
    });
    const cleaned =
      removed.status === 'saved' && removed.runId ? await wait(removed.runId) : undefined;
    const report = {
      recordedAt: new Date().toISOString(),
      scope: 'synthetic-only',
      model: selectedModel,
      sample: text,
      extractionMode: p2ReportPath ? 'replayed-real-P2-output' : 'live',
      p2ReportPath,
      durationMs: Date.now() - startedAt,
      generated,
      removed,
      cleaned,
      documents: files.list(),
      status: memory.getStatus(),
    };
    writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
    const passed =
      generated.status === 'completed' &&
      generated.run.status === 'completed' &&
      firstDocuments.some(
        document => document.path === 'MEMORY.md' && document.content.includes('TypeScript'),
      ) &&
      cleaned?.status === 'completed' &&
      cleaned.run.status === 'completed' &&
      !files.read('MEMORY.md')?.content.includes('TypeScript');
    console.log(
      JSON.stringify(
        {
          passed,
          root,
          model: selectedModel,
          durationMs: report.durationMs,
          generated,
          removed,
          cleaned,
        },
        null,
        2,
      ),
    );
    if (!passed) process.exitCode = 1;
  } finally {
    await memory.shutdown();
    await trace.shutdown();
    database.close();
  }
}

void main().catch(() => {
  console.error('Consolidation probe failed; inspect the isolated report.');
  process.exitCode = 1;
});
