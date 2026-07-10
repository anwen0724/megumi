/* Node/Electron adapter that appends Product-formatted runtime log records. */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RuntimeLogWriterPort } from '@megumi/product/logging';

export const electronRuntimeLogWriterAdapter: RuntimeLogWriterPort = {
  appendText(filePath, text) {
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, text, 'utf8');
  },
};
