/* Opt-in protocol verification with synthetic histories and an isolated database. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApplicationModels } from '../../packages/application/src/compose-modules';
import { createSettings } from '../../packages/application/src/settings/settings-store';
import { createDatabase, migrateDatabase } from '../../packages/application/src/storage/index';
import { createSessionStore } from '../../packages/application/src/coding/sessions/session-storage';
import { createSessionHistory } from '../../packages/application/src/coding/sessions/session-history';
import { createMemorySources } from '../../packages/application/src/coding/sessions/memory-sources';
import { createMemoryExtraction } from '../../packages/application/src/memory/extraction';
import { resolveExtractionModel } from '../../packages/application/src/memory/extraction-model';
import {
  composeObservability,
  nodeObservabilityStorage,
} from '../../packages/application/src/observability/index';

async function main() {
  if (!process.argv.includes('--run'))
    throw new Error(
      'Pass --run only after authorizing the synthetic histories for the configured provider.',
    );

  const home = process.env.MEGUMI_HOME ?? path.join(os.homedir(), '.megumi');
  const global = createSettings({
    globalSettingsPath: path.join(home, 'settings.json'),
    credentialsPath: path.join(home, 'credentials.json'),
    readEnvironment: name => process.env[name],
  });
  const read = global.readSettings();
  if (read.status !== 'ok') throw new Error('The global settings cannot be read.');

  const selection = read.settings.config.general.lastSelectedModel;
  if (!selection) throw new Error('The default conversation model is not configured.');

  const parent = path.resolve('.tmp');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'memory-p2-protocol-'));
  const configuration = {
    ...read.settings.config,
    memory: {
      ...read.settings.config.memory,
      generateMemories: true,
      extractModel: selection,
    },
  };
  writeFileSync(path.join(root, 'settings.json'), JSON.stringify(configuration, null, 2));
  const isolated = createSettings({
    globalSettingsPath: path.join(root, 'settings.json'),
    credentialsPath: path.join(root, 'credentials.json'),
    readEnvironment: name => process.env[name],
  });
  // Credentials are read in place; no credentials or real histories are copied into the probe.
  const settings = {
    ...isolated,
    readCredential: global.readCredential,
  };
  const models = createApplicationModels({ settingsForWorkspace: () => settings });
  const databasePath = path.join(root, 'memory.db');
  let database = createDatabase({ filename: databasePath });
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
  const history = createSessionHistory({
    store,
    ids: { entryId: ({ source_id }) => `entry:${source_id}` },
  });
  const samples = [
    {
      id: 'learning',
      text: '这是虚构的 React/TypeScript 学习会话。我学习 React，后续代码示例请使用 TypeScript。解释 Hook 时，先展示一个最小可运行例子，再解释依赖数组；不要默认我熟悉闭包。',
    },
    {
      id: 'greeting',
      text: '你好。今天没有任务，谢谢，再见。',
    },
  ];
  for (const sample of samples) {
    store.insertSession({
      session_id: sample.id,
      workspace_id: 'synthetic',
      title: 'Synthetic conversation',
      status: 'active',
      created_at: historical,
      updated_at: historical,
    });

    const saved = await history.saveUserMessage({
      session_id: sample.id,
      message_id: `user:${sample.id}`,
      display_content: [
        {
          type: 'text',
          text: sample.text,
        },
      ],
      model_content: [
        {
          type: 'text',
          text: sample.text,
        },
      ],
      created_at: historical,
    });
    if (saved.status !== 'saved') throw new Error('Synthetic history could not be saved.');
  }

  let calls = 0;
  const create = () =>
    createMemoryExtraction({
      database,
      sources: createMemorySources({
        store: createSessionStore({ database }),
        isSessionRunning: () => false,
      }),
      readConfiguration: () => configuration.memory,
      workspaceDirectory: () => 'C:/synthetic-react',
      observability: trace.observability,
      resolveModel: async modelSelection => {
        const resolved = await resolveExtractionModel({
          models,
          settings,
          selection: modelSelection,
        });
        return {
          ...resolved,
          complete: (context, options) => {
            calls++;
            return resolved.complete(context, options);
          },
        };
      },
    });
  let extraction = create();

  try {
    const started = Date.now();
    const result = await extraction.extract();
    const outputs = samples.map(sample => ({
      sample: sample.id,
      extraction: extraction.getExtraction(sample.id),
    }));
    await extraction.shutdown();
    database.close();
    database = createDatabase({ filename: databasePath });
    extraction = create();
    const callsBeforeRestart = calls;
    const restart = await extraction.extract();
    await trace.flush();

    const traces = await trace.queries.listTraces();
    const report = {
      recordedAt: new Date().toISOString(),
      model: selection,
      scope: 'synthetic-only',
      samples,
      result,
      outputs,
      durationMs: Date.now() - started,
      modelCalls: calls,
      callsAfterRestart: calls - callsBeforeRestart,
      restart,
      traces,
    };
    writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
    const passed =
      result.status === 'completed' &&
      result.jobs.length === 2 &&
      result.jobs.every(job => job.status === 'succeeded') &&
      calls === callsBeforeRestart &&
      !!outputs[0].extraction?.rawMemory.trim() &&
      outputs[1].extraction?.rawMemory === '';
    console.log(
      JSON.stringify(
        {
          passed,
          root,
          model: selection,
          modelCalls: calls,
          callsAfterRestart: calls - callsBeforeRestart,
          jobs:
            result.status === 'completed'
              ? result.jobs.map(job => ({
                  status: job.status,
                  error: job.error,
                  result: job.result,
                }))
              : result,
        },
        null,
        2,
      ),
    );
    if (!passed) process.exitCode = 1;
  } finally {
    await extraction.shutdown();
    await trace.shutdown();
    database.close();
  }
}

void main().catch(() => {
  console.error(
    'Memory protocol verification failed. Check the configured provider and isolated result.',
  );
  process.exitCode = 1;
});
