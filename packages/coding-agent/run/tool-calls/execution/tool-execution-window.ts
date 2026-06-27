// Selects and executes tool execution windows without violating serial or approval barriers.
import type { ToolExecutionRecord } from '@megumi/shared/tool';
import type { CodingAgentToolExecutionRunOptions } from '../../../tools/tool-execution-host-port';
import type { ResolvedToolCallRunnerOptions } from '../tool-call-runner';
import { runToolExecutionRecord } from './tool-execution-record';

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

export async function advanceExecutionWindows(
  options: ResolvedToolCallRunnerOptions,
  input: {
    runId: string;
    assistantMessageId: string;
    executionOptions?: CodingAgentToolExecutionRunOptions;
  },
): Promise<ToolExecutionRecord[]> {
  try {
    let records = options.repository.listToolExecutionsByAssistantMessage(input);

    while (!input.executionOptions?.signal?.aborted) {
      const window = nextExecutableWindow(records);
      if (window.length === 0) {
        return records;
      }

      if (window.length === 1) {
        await runToolExecutionRecord(options, window[0], input.executionOptions);
      } else {
        await Promise.all(window.map((record) => runToolExecutionRecord(options, record, input.executionOptions)));
      }

      records = options.repository.listToolExecutionsByAssistantMessage(input);
    }

    for (const record of records) {
      if (isActiveStatus(record.status)) {
        options.repository.saveToolExecution({
          ...record,
          status: 'cancelled',
          completedAt: options.now(),
        });
      }
    }
    return options.repository.listToolExecutionsByAssistantMessage(input);
  } finally {
    finalizeWorkspaceChangeSet(options, input.executionOptions);
  }
}

function finalizeWorkspaceChangeSet(
  options: ResolvedToolCallRunnerOptions,
  executionOptions?: CodingAgentToolExecutionRunOptions,
): void {
  if (!executionOptions?.scope) {
    return;
  }

  options.toolExecutionRouter.finalizeWorkspaceChangeSet?.(executionOptions.scope);
}
