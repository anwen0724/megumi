// Calculates Tool-use execution windows from tool constraints; execution stays in the runner.
import type { ToolExecutionMode, ToolMutationKind } from '../tools';

export interface ToolExecutionWindowInput {
  callId: string;
  executionMode: ToolExecutionMode;
  mutation: ToolMutationKind;
}

export type ToolExecutionWindow =
  | { mode: 'serial'; callIds: [string] }
  | { mode: 'parallel'; callIds: string[] };

export function createToolExecutionWindows(calls: ToolExecutionWindowInput[]): ToolExecutionWindow[] {
  const windows: ToolExecutionWindow[] = [];
  let parallelWindow: string[] = [];

  const flushParallel = () => {
    if (parallelWindow.length > 0) {
      windows.push({ mode: 'parallel', callIds: parallelWindow });
      parallelWindow = [];
    }
  };

  for (const call of calls) {
    if (canRunInParallel(call)) {
      parallelWindow.push(call.callId);
      continue;
    }

    flushParallel();
    windows.push({ mode: 'serial', callIds: [call.callId] });
  }

  flushParallel();
  return windows;
}

function canRunInParallel(call: ToolExecutionWindowInput): boolean {
  return call.executionMode === 'parallel' && call.mutation === 'read_only';
}
