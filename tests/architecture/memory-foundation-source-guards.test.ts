import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();

function productionFilesUnder(...segments: string[]): string[] {
  const start = join(root, ...segments);
  const files: string[] = [];
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
  it('keeps packages/memory platform independent', () => {
    const files = productionFilesUnder('packages', 'memory');
    expect(offenders(files, /from ['"](electron|node:fs|fs|node:path|path)['"]|@megumi\/(db|ai)(\/|['"]|$)|packages\/(db|ai)|apps\/desktop|session-run|provider adapter|providers\//i)).toEqual([]);
  });

  it('keeps packages/memory on deterministic recall without vector search', () => {
    const files = productionFilesUnder('packages', 'memory');
    expect(offenders(files, /\bembedding\b|\bvector\b|cosineSimilarity|\bann\b|faiss/i)).toEqual([]);
  });

  it('keeps packages/memory free from runtime file IO operations', () => {
    const files = productionFilesUnder('packages', 'memory');
    expect(offenders(files, /\b(readFile|writeFile|appendFile|rename|watch)\b/)).toEqual([]);
  });

  it('keeps core memory helpers free from Host and persistence dependencies', () => {
    const files = productionFilesUnder('packages', 'core', 'agent-runtime');
    expect(offenders(files, /memory\.service|MemoryRepository|@megumi\/db|from ['"]electron['"]|from ['"]node:fs['"]|from ['"]fs['"]|apps\//)).toEqual([]);
  });

  it('keeps renderer memory behind preload and away from privileged storage', () => {
    const files = productionFilesUnder('apps', 'desktop', 'src', 'renderer');
    expect(offenders(files, /MemoryRepository|better-sqlite3|safeStorage|megumi_home|Megumi Home|from ['"]electron['"]|@megumi\/db/)).toEqual([]);
  });

  it('does not implement out-of-scope memory capabilities in 08 foundation', () => {
    const files = [
      ...productionFilesUnder('packages', 'memory'),
      ...productionFilesUnder('apps', 'desktop', 'src', 'main', 'services'),
      ...productionFilesUnder('apps', 'desktop', 'src', 'renderer', 'entities', 'memory'),
    ];
    expect(offenders(files, /\bembedding\b|\bvector\b|\brerank\b|knowledge graph|external memory server|submemory|team memory|MCP memory|reflection|evaluator|metrics/iu)).toEqual([]);
  });

  it('does not expose raw sensitive memory content through events logs or renderer state', () => {
    const files = [
      ...productionFilesUnder('packages', 'shared'),
      ...productionFilesUnder('packages', 'memory'),
      ...productionFilesUnder('packages', 'context-management'),
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
