// Selects which queued tool executions may run next without violating serial or approval barriers.
import type { ToolExecutionRecord } from '@megumi/shared/tool';

export function nextExecutableWindow(records: readonly ToolExecutionRecord[]): ToolExecutionRecord[] {
  const window: ToolExecutionRecord[] = [];

  for (const record of [...records].sort((a, b) => (a.callOrder ?? 0) - (b.callOrder ?? 0))) {
    if (isContinuationTerminal(record.status)) {
      continue;
    }
    if (record.status === 'cancelled' || record.status === 'created') {
      return window;
    }
    if (record.status === 'awaitingApproval' || record.status === 'running') {
      return window;
    }
    if (record.status !== 'queued') {
      return window;
    }

    if (record.executionMode === 'parallel') {
      window.push(record);
      continue;
    }

    if (window.length === 0) {
      window.push(record);
    }
    return window;
  }

  return window;
}

export function isContinuationTerminal(status: ToolExecutionRecord['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'rejected';
}

export function isActiveStatus(status: ToolExecutionRecord['status']): boolean {
  return status === 'created' || status === 'awaitingApproval' || status === 'queued' || status === 'running';
}
