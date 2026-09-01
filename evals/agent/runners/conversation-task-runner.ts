/* Runs multi-step Conversation Tasks in one Session and captures produced Workspace files. */
import type { AnyEvent } from '@megumi/events';
import type { EvaluationTask } from '../contracts/evaluation-task';
import {
  snapshotWorkspace,
  toJsonRecord,
  waitForCommittedRun,
  type TaskRunner,
} from '../runtime/evidence-collector';

type ConversationTask = Extract<EvaluationTask, { runner: 'conversation' }>;

export const conversationTaskRunner: TaskRunner<ConversationTask> = {
  runner: 'conversation',
  async execute(context) {
    let sessionId = Object.values(context.scenarioIds.sessions)[0];
    const before = sessionId
      ? await context.runtime.host.session.readSession({ sessionId })
      : { status: 'new_session' };
    const runtimeEvents: AnyEvent[] = [];
    const completions: Readonly<Record<string, unknown>>[] = [];
    const correlations: Readonly<Record<string, string>>[] = [];
    const subscription = context.runtime.subscribeRuntimeEvents({}, (event) => { runtimeEvents.push(event); });
    try {
      for (const step of context.task.steps) {
        const result = await context.runtime.host.session.sendUserInput({
          ...(sessionId ? { sessionId } : {}),
          projectId: context.scenarioIds.workspaceId,
          text: step.userInput,
          modelSelection: {
            provider_id: context.candidateModel.providerId,
            model_id: context.candidateModel.modelId,
          },
          permissionMode: step.permissionMode,
          createdAt: context.now(),
        });
        if (result.payload.type !== 'agent_run') {
          throw new Error(`Conversation step did not start an Agent Execution: ${result.payload.type}.`);
        }
        sessionId = result.payload.session.id;
        completions.push(await waitForCommittedRun({
          runtime: context.runtime,
          sessionId,
          executionId: result.payload.run.executionId,
          timeoutMs: context.task.completion.timeoutMs,
        }));
        correlations.push({
          executionId: result.payload.run.executionId,
          sessionId,
          messageId: result.payload.userMessageId,
        });
      }
      if (!sessionId) throw new Error('Conversation Task did not create a Session.');
      return {
        input: toJsonRecord({ steps: context.task.steps }),
        beforeFacts: toJsonRecord(before),
        completion: toJsonRecord({ steps: completions }),
        afterFacts: toJsonRecord({
          session: await context.runtime.host.session.readSession({ sessionId }),
          workspaceFiles: await snapshotWorkspace(context.workspacePath),
        }),
        correlations,
        runtimeEvents,
      };
    } finally {
      subscription.unsubscribe();
    }
  },
};
