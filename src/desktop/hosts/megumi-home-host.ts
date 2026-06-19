// Resolves local Megumi home paths without defining database schema.
import os from 'node:os';
import path from 'node:path';

export interface MegumiHomeHost {
  getMegumiHome(): string;
}

export function createMegumiHomeHost(): MegumiHomeHost {
  return {
    getMegumiHome: () => path.join(os.homedir(), '.megumi'),
  };
}
