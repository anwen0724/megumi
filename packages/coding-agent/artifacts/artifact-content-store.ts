import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArtifactContentRef } from './legacy-contracts/artifact-contracts';

export interface ArtifactContentStoreOptions {
  artifactRoot: string;
  inlineTextLimitBytes?: number;
  now?: () => string;
}

export interface ArtifactContentWriteInput {
  artifactId: string;
  artifactVersionId: string;
  text: string;
  mimeType: string;
}

export class ArtifactContentStore {
  private readonly inlineTextLimitBytes: number;
  private readonly now: () => string;

  constructor(private readonly options: ArtifactContentStoreOptions) {
    this.inlineTextLimitBytes = options.inlineTextLimitBytes ?? 16 * 1024;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async writeText(input: ArtifactContentWriteInput): Promise<ArtifactContentRef> {
    const bytes = Buffer.from(input.text, 'utf8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const textPreview = createTextPreview(input.text);
    const createdAt = this.now();

    if (bytes.byteLength <= this.inlineTextLimitBytes) {
      return {
        storage: 'inline',
        inlineText: input.text,
        mimeType: input.mimeType,
        sizeBytes: bytes.byteLength,
        sha256,
        textPreview,
        redactionState: 'safe',
        createdAt,
      };
    }

    const artifactSegment = safeSegment(input.artifactId);
    const versionSegment = safeSegment(input.artifactVersionId);
    const extension = extensionForMimeType(input.mimeType);
    const contentKey = `${artifactSegment}/${versionSegment}/content${extension}`;
    const targetPath = path.join(this.options.artifactRoot, artifactSegment, versionSegment, `content${extension}`);

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, input.text, { encoding: 'utf8' });

    return {
      storage: 'megumi_home',
      contentKey,
      mimeType: input.mimeType,
      sizeBytes: bytes.byteLength,
      sha256,
      textPreview,
      redactionState: 'safe',
      createdAt,
    };
  }
}

function createTextPreview(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

function safeSegment(value: string): string {
  if (value.includes('..') || value.includes('/') || value.includes('\\')) {
    throw new Error('Unsafe artifact content id.');
  }
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'text/markdown') {
    return '.md';
  }
  if (mimeType === 'application/json') {
    return '.json';
  }
  if (mimeType.includes('typescript')) {
    return '.ts';
  }
  return '.txt';
}

