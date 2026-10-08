/* Prepares fictional evidence through the real Memory producer for isolated Electron acceptance. */
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fauxAssistantMessage } from '@megumi/ai';
import { createMemory } from '../../packages/application/src/memory/memory';
import { createMemoryExtraction } from '../../packages/application/src/memory/extraction';
import { productionFixture } from '../../tests/packages/memory/production-fixture';
import { createMegumiHomeVersion } from '../../packages/application/src/storage/home-initializer';

/** Uses faux responses only at model boundaries; never writes final knowledge by hand. */
async function main() {
  if (!process.argv.includes('--prepare'))
    throw new Error('Use --prepare to create a new isolated fixture.');
  const parent = path.resolve('.tmp');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'memory-desktop-'));
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  mkdirSync(path.join(home, 'sqlite'), { recursive: true });
  mkdirSync(workspace);
  process.env.TEMP = root;
  process.env.TMP = root;
  const f = productionFixture();
  try {
    await f.user(
      'u1',
      'This is a fictional desktop acceptance conversation. Use TypeScript for React examples.',
    );
    f.database
      .prepare({
        sql: "UPDATE workspaces SET root_path = ?, root_path_key = ?, created_at = '2026-10-01T00:00:00Z', updated_at = '2026-10-01T00:00:00Z', last_opened_at = '2026-10-01T00:00:00Z' WHERE workspace_id = ?",
      })
      .run([workspace, workspace.toLowerCase(), 'w1']);
    f.database
      .prepare({
        sql: "UPDATE sessions SET created_at = '2026-10-01T00:00:00Z' WHERE session_id = 's1'",
      })
      .run();
    f.responses();
    const generated = await f.generate();
    if (generated.status !== 'completed' || generated.result?.result !== 'generated')
      throw new Error('Fixture production did not complete.');
    const task = f.memory.createTaskMemory({
      workspaceId: 'w1',
      workspaceDirectory: workspace,
      inputBudgetTokens: 30000,
    });
    task.getPromptMemory('desktop-reply');
    const read = task.read({ path: 'MEMORY.md' });
    if (read.status !== 'found' || !read.references.length)
      throw new Error('Fixture has no verified citations.');
    f.store.insertSession({
      session_id: 'task',
      workspace_id: 'w1',
      title: 'Desktop memory verification',
      status: 'active',
      created_at: '2026-10-08T00:00:00Z',
      updated_at: '2026-10-08T00:00:00Z',
    });
    await f.history.saveUserMessage({
      session_id: 'task',
      message_id: 'task-user',
      execution_id: 'desktop-reply',
      display_content: [
        {
          type: 'text',
          text: 'Which example language should I use?',
        },
      ],
      model_content: [
        {
          type: 'text',
          text: 'Which example language should I use?',
        },
      ],
      created_at: '2026-10-08T12:00:00Z',
    });
    const reply = f.history.saveAssistantReply({
      session_id: 'task',
      message_id: 'desktop-reply',
      execution_id: 'desktop-reply',
      status: 'completed',
      content: [
        {
          type: 'text',
          text: `Desktop acceptance answer: use TypeScript.\n<memory_citations>${JSON.stringify(read.references)}</memory_citations>`,
        },
      ],
      memory_evidence: task.evidence(),
      completed_at: '2026-10-08T13:00:00Z',
    });
    if (reply.status !== 'saved') throw new Error('Fixture reply was not saved.');
    f.memory.recordUsage();
    await f.memory.shutdown();
    f.database.prepare({ sql: 'PRAGMA wal_checkpoint(TRUNCATE)' }).all();
    cpSync(path.join(f.root, 'memory.db'), path.join(home, 'sqlite', 'megumi.sqlite'));
    cpSync(path.join(f.root, 'memories'), path.join(home, 'memories'), { recursive: true });
    const settings = f.settings.readSettings();
    if (settings.status !== 'ok') throw new Error('Fixture settings are unavailable.');
    const config = settings.settings.config;
    writeFileSync(
      path.join(home, 'settings.json'),
      JSON.stringify(
        {
          ...config,
          general: {
            ...config.general,
            setupCompleted: true,
            language: 'zh-CN',
          },
          memory: {
            ...config.memory,
            extractModel: undefined,
            consolidationModel: undefined,
            generateMemories: false,
            useMemories: true,
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      path.join(home, 'version.json'),
      JSON.stringify(createMegumiHomeVersion(new Date())),
    );
    // Failure snapshots use the same real producer; only the model response boundary changes.
    f.store.insertSession({
      session_id: 'failure',
      workspace_id: 'w1',
      title: 'Synthetic failed extraction',
      status: 'active',
      created_at: '2026-10-02T00:00:00Z',
      updated_at: '2026-10-02T00:00:00Z',
    });
    await f.history.saveUserMessage({
      session_id: 'failure',
      message_id: 'failure-user',
      display_content: [
        {
          type: 'text',
          text: '__extraction_failure__',
        },
      ],
      model_content: [
        {
          type: 'text',
          text: '__extraction_failure__',
        },
      ],
      created_at: '2026-10-02T00:00:00Z',
    });
    await f.user('u2', 'Use TypeScript for React examples and explain each dependency.');
    const extraction = createMemoryExtraction({
      database: f.database,
      sources: f.sources,
      readConfiguration: f.config,
      workspaceDirectory: () => workspace,
      now: f.options.now,
      resolveModel: async () => ({
        model: (await f.options.resolveModel()).model,
        secrets: [],
        complete: async context => {
          if (JSON.stringify(context).includes('__extraction_failure__'))
            throw new Error('MODEL_FAILED');
          return fauxAssistantMessage(
            JSON.stringify({
              rawMemory: 'Use TypeScript for React examples.',
              rolloutSummary: 'User prefers TypeScript.',
              rolloutSlug: 'react',
            }),
          );
        },
      }),
    });
    const failureMemory = createMemory({
      ...f.options,
      extraction,
    });

    async function runCase(requestId: string) {
      const started = failureMemory.startGeneration({
        requestId,
        reason: 'manual',
      });
      if (started.status !== 'started') throw new Error('Failure case was not accepted.');
      const result = await failureMemory.waitRun({
        runId: started.runId,
        timeoutMs: 5000,
      });
      if (result.status !== 'completed') throw new Error('Failure case did not settle.');
      return result.run;
    }

    function saveCase(name: string) {
      const target = path.join(root, `home-${name}`);
      cpSync(home, target, { recursive: true });
      f.database.prepare({ sql: 'PRAGMA wal_checkpoint(TRUNCATE)' }).all();
      cpSync(path.join(f.root, 'memory.db'), path.join(target, 'sqlite', 'megumi.sqlite'));
      cpSync(path.join(f.root, 'memories'), path.join(target, 'memories'), { recursive: true });
      return target;
    }
    f.responses();
    const partial = await runCase('partial-extraction');
    if (
      partial.result?.result !== 'partial' ||
      !partial.jobs.some(job => job.stage === 'extract' && job.status === 'failed')
    )
      throw new Error('Partial extraction case is invalid.');
    const partialHome = saveCase('partial');
    const document = f.files.read('MEMORY.md');
    if (!document) throw new Error('No document before interruption.');
    failureMemory.updateDocument({
      requestId: 'dirty-before-interrupt',
      path: document.path,
      expectedVersion: document.version,
      content: document.content,
    });
    f.provider.setResponses([
      f.tool('memory_file', {
        action: 'write',
        path: 'MEMORY.md',
        expectedVersion: document.version,
        content: '# Interrupted consolidation',
      }),
      () => {
        const status = failureMemory.getStatus();
        if (status.status !== 'ok' || !status.memory.recentRuns[0])
          throw new Error('Active run is missing.');
        failureMemory.cancelRun({
          requestId: 'cancel-consolidation',
          runId: status.memory.recentRuns[0].runId,
        });
        return fauxAssistantMessage('Cancelled.');
      },
    ]);
    const interrupted = await runCase('interrupted-consolidation');
    const interruptedStatus = failureMemory.getStatus();
    if (
      interrupted.status !== 'cancelled' ||
      interruptedStatus.status !== 'ok' ||
      interruptedStatus.memory.artifactState !== 'needsRepair'
    )
      throw new Error('Interruption case is invalid.');
    const interruptedHome = saveCase('interrupted');
    await failureMemory.shutdown();
    const fixture = {
      scope: 'synthetic-only',
      root,
      home,
      workspace,
      sourceId: 's1',
      generated,
      scenarioHomes: {
        partial: partialHome,
        interrupted: interruptedHome,
      },
      partial,
      interrupted,
    };
    const file = path.join(root, 'fixture.json');
    writeFileSync(file, JSON.stringify(fixture, null, 2));
    console.log(
      JSON.stringify({
        fixture: file,
        scope: fixture.scope,
        generation: generated.result?.result,
      }),
    );
  } finally {
    await f.dispose();
  }
}
void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
