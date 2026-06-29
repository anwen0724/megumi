import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();

function productionFilesUnder(...segments: string[]): string[] {
  const start = join(root, ...segments);
  const files: string[] = [];
  if (!existsSync(start)) {
    return files;
  }
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist' || entry === '.vite') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
        files.push(full);
      }
    }
  }
  walk(start);
  return files;
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

function offenders(files: string[], pattern: RegExp): string[] {
  return files
    .filter((file) => pattern.test(read(file)))
    .map((file) => relative(root, file).replace(/\\/g, '/'));
}

describe('memory foundation boundaries', () => {
  it('keeps packages/coding-agent/memory platform independent', () => {
    const files = productionFilesUnder('packages', 'coding-agent', 'memory');
    expect(offenders(files, /from ['"](electron|node:fs|fs|node:path|path)['"]|@megumi\/(db|ai)(\/|['"]|$)|packages\/(db|ai)|apps\/desktop|session-run|provider adapter|providers\//i)).toEqual([]);
  });

  it('keeps Desktop Main persistence memory repository free from memory business logic', () => {
    const files = productionFilesUnder('apps', 'desktop', 'src', 'main', 'persistence', 'repos');
    expect(offenders(files, /@megumi\/memory|memory-markdown-sync\.service|memory-runtime-capture\.service|memory-diagnostic-writer\.service/)).toEqual([]);
  });

  it('keeps Desktop Main memory runtime away from provider adapter implementations', () => {
    const files = productionFilesUnder('apps', 'desktop', 'src', 'main', 'services', 'memory');
    expect(offenders(files, /packages\/ai\/providers|@megumi\/ai\/providers|openai-compatible|provider adapter implementation/i)).toEqual([]);
  });

  it('keeps provider adapters and prompt mappers away from memory persistence and recall scoring', () => {
    const files = productionFilesUnder('packages', 'ai');
    expect(offenders(files, /MemoryRepository|@megumi\/db|better-sqlite3|memory-markdown-sync|memory-recall-runtime|memory-runtime-capture|recall-scoring|@megumi\/memory/)).toEqual([]);
  });

  it('keeps InputProcessingService orchestration behind the recall port instead of recall scoring', () => {
    const files = [
      join(root, 'packages', 'coding-agent', 'input', 'input-service.ts'),
    ];
    expect(offenders(files, /@megumi\/memory|MemoryRepository|@megumi\/db\/repos\/memory|memory-runtime-capture\.service|memory-recall-runtime\.service|recall-scoring|buildMemoryRecallSnapshot|selectMemoryRecallResults/)).toEqual([]);
  });

  it('wires memory markdown lifecycle sync through Desktop Main composition', () => {
    const index = [
      read(join(root, 'packages', 'coding-agent', 'composition', 'compose-coding-agent-memory.ts')),
      read(join(root, 'packages', 'coding-agent', 'composition', 'compose-coding-agent-session-runtime.ts')),
    ].join('\n');
    const sessionService = read(join(root, 'packages', 'coding-agent', 'session', 'session-service.ts'));

    expect(index).toContain('syncUserMirrorOnAppStart');
    expect(index).toContain('options.memorySettingsProvider.isMemoryEnabled()');
    expect(index).toContain('memoryMarkdownSyncService: options.memoryRuntime.markdownSyncService');
    expect(sessionService).toContain('syncProjectMirrorOnProjectOpened');
  });

  it('keeps renderer free from legacy memory panel and recall preview UI', () => {
    const files = productionFilesUnder('apps', 'desktop', 'src', 'renderer');
    expect(offenders(files, /MemoryPanelTab|entities\/memory|entities\\memory|useMemoryStore|MemoryNoteCard|recallPreview|candidateList/)).toEqual([]);
  });

  it('keeps internal memory extraction client behind model-step provider boundary', () => {
    const files = [
      join(root, 'packages', 'coding-agent', 'memory', 'memory-extraction-model-client.ts'),
    ];
    expect(offenders(files, /MemoryRepository|better-sqlite3|memory-markdown-sync|memory-runtime-capture|packages\/ai\/providers|@megumi\/ai\/providers|openai-compatible/)).toEqual([]);
  });

  it('uses structured model output for memory extraction before text JSON fallback', () => {
    const extraction = read(join(root, 'packages', 'coding-agent', 'memory', 'extraction.ts'));
    const client = read(join(root, 'packages', 'coding-agent', 'memory', 'memory-extraction-model-client.ts'));
    const capture = read(join(root, 'packages', 'coding-agent', 'memory', 'memory-runtime-capture.ts'));

    expect(extraction).toContain('MEMORY_EXTRACTION_OUTPUT_JSON_SCHEMA');
    expect(client).toContain('structuredOutput:');
    expect(client).toContain('parseMemoryExtractionStructuredOutput');
    expect(capture).toContain('parseMemoryExtractionStructuredOutput(extraction.structuredOutput)');
  });

  it('keeps renderer out of hidden model-input memory injection plumbing', () => {
    const files = productionFilesUnder('apps', 'desktop', 'src', 'renderer');
    expect(offenders(files, /ModelInputContext|memoryRecallSources|memoryRecallSeed|memory-recall-runtime\.service|memory-markdown-sync\.service/)).toEqual([]);
  });

  it('does not implement memory markdown sync with realtime file watchers', () => {
    const files = [
      ...productionFilesUnder('packages', 'memory'),
      ...productionFilesUnder('packages', 'db'),
      ...productionFilesUnder('apps', 'desktop', 'src', 'main'),
    ];
    expect(offenders(files, /\bfs\.watch\b|\bwatchFile\b|from ['"]chokidar['"]|require\(['"]chokidar['"]\)/)).toEqual([]);
  });

  it('keeps renderer from importing Desktop Main memory runtime services', () => {
    const files = productionFilesUnder('apps', 'desktop', 'src', 'renderer');
    expect(offenders(files, /memory-runtime-capture\.service|memory-markdown-sync\.service|memory-diagnostic-writer\.service|memory-runtime-file-system|memory-runtime-paths/)).toEqual([]);
  });

  it('keeps packages/coding-agent/memory on deterministic recall without vector search', () => {
    const files = productionFilesUnder('packages', 'coding-agent', 'memory');
    expect(offenders(files, /\bembedding\b|\bvector\b|cosineSimilarity|\bann\b|faiss/i)).toEqual([]);
  });

  it('keeps packages/coding-agent/memory free from runtime file IO operations', () => {
    const files = productionFilesUnder('packages', 'coding-agent', 'memory');
    expect(offenders(files, /\b(readFile|writeFile|appendFile|rename|watch)\b/)).toEqual([]);
  });

  it('keeps coding-agent memory helpers free from Host and persistence dependencies', () => {
    const files = productionFilesUnder('packages', 'coding-agent', 'memory');
    expect(offenders(files, /MemoryRepository|@megumi\/db|from ['"]electron['"]|from ['"]node:fs['"]|from ['"]fs['"]|apps\//)).toEqual([]);
  });

  it('keeps renderer memory behind preload and away from privileged storage', () => {
    const files = productionFilesUnder('apps', 'desktop', 'src', 'renderer');
    expect(offenders(files, /MemoryRepository|better-sqlite3|safeStorage|megumi_home|Megumi Home|from ['"]electron['"]|@megumi\/db/)).toEqual([]);
  });

  it('does not implement out-of-scope memory capabilities in 08 foundation', () => {
    const files = [
      ...productionFilesUnder('packages', 'coding-agent', 'memory'),
      ...productionFilesUnder('apps', 'desktop', 'src', 'main', 'services'),
      ...productionFilesUnder('apps', 'desktop', 'src', 'renderer', 'entities', 'memory'),
    ];
    expect(offenders(files, /\bembedding\b|\bvector\b|\brerank\b|knowledge graph|external memory server|submemory|team memory|MCP memory|memory reflection|memory evaluator|memory metrics/iu)).toEqual([]);
  });

  it('does not expose raw sensitive memory content through events logs or renderer state', () => {
    const files = [
      ...productionFilesUnder('packages', 'shared'),
      ...productionFilesUnder('packages', 'coding-agent', 'memory'),
      ...productionFilesUnder('packages', 'coding-agent'),
      ...productionFilesUnder('packages', 'core'),
      ...productionFilesUnder('apps', 'desktop', 'src', 'main'),
      ...productionFilesUnder('apps', 'desktop', 'src', 'renderer', 'entities', 'memory'),
    ];
    expect(offenders(files, /rawFullPrompt|rawProviderBody|rawRestrictedFileContent|plaintextSecret|rawStack|rawCause/)).toEqual([]);
  });

  it('keeps packages/memory from exporting short-term context management builders', () => {
    const files = productionFilesUnder('packages', 'memory');
    expect(offenders(files, /ModelInputContextBuilder|buildModelInputContext|model-input-context-builder/)).toEqual([]);
  });
});
