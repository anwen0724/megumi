// Wraps process execution for tool/runtime host injection.
import { spawn } from 'node:child_process';

export interface ProcessHost {
  spawn: typeof spawn;
}

export function createProcessHost(): ProcessHost {
  return { spawn };
}
