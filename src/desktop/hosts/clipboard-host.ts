// Wraps Electron clipboard for desktop input collection.
import { clipboard } from 'electron';

export interface ClipboardHost {
  readText(): string;
  writeText(text: string): void;
}

export function createClipboardHost(): ClipboardHost {
  return {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(text),
  };
}
