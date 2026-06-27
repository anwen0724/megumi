// Determines when tool execution records are ready to become model continuation results.
import type { ToolExecutionRecord } from '@megumi/shared/tool';
import { isContinuationTerminal } from '../execution/tool-execution-window';

export type {
  ToolContinuationInputContextBuilderInput,
} from '../../loop';

export function continuationReady(records: readonly ToolExecutionRecord[]): boolean {
  if (records.length === 0) {
    return true;
  }
  return records.every((record) => isContinuationTerminal(record.status) && Boolean(record.observation));
}
