// Owns resumed model/tool loop wiring after a paused tool approval is resolved.
import type { ModelInputContext, ModelInputContextBuildRequest, ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { PermissionMode } from '@megumi/shared/permission';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { RunStep } from '@megumi/shared/session';
import type {
  BuildModelCallInputInput,
  BuildModelCallInputResult,
  ModelInputMemoryRecallSource,
} from '../../context';
import type { ModelCallPort } from '../../agent-loop/model-call';
import type { PendingToolApprovalContinuation } from '../tool-calls/tool-call-contract';
import type { ToolCallRunnerService } from '../tool-calls';
import {
  streamCodingAgentModelToolLoop,
  type CodingAgentModelToolLoopStreamIds,
  type CodingAgentRunSourceOverrideProvider,
} from './model-tool-loop-stream';

export interface ApprovalResumeModelLoopInput {
  pendingRequest: ModelStepRuntimeRequest;
  resumedStep: RunStep;
  resumedInputContext: ModelInputContext;
  decidedAt: string;
  toolRuntime: ToolCallRunnerService;
  modelCallPort: ModelCallPort;
  modelCallInputBuildService: {
    buildModelCallInput(input: BuildModelCallInputInput): Promise<BuildModelCallInputResult>;
  };
  sourceOverrideProvider: CodingAgentRunSourceOverrideProvider;
  ids: CodingAgentModelToolLoopStreamIds;
  projectRoot?: string;
  permissionMode?: PermissionMode;
  memoryRecall?: {
    memoryRecallSources?: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  };
}

export interface ApprovalResumeModelLoop {
  request: ModelStepRuntimeRequest;
  modelEvents: AsyncIterable<RuntimeEvent>;
  pendingContinuations: PendingToolApprovalContinuation[];
}

export function streamApprovalResumeModelLoop(input: ApprovalResumeModelLoopInput): ApprovalResumeModelLoop {
  const request: ModelStepRuntimeRequest = {
    ...input.pendingRequest,
    stepId: input.resumedStep.stepId,
    modelStepId: input.ids.nextModelStepId(),
    inputContext: input.resumedInputContext,
    createdAt: input.decidedAt,
  };
  const pendingContinuations: PendingToolApprovalContinuation[] = [];
  const modelEvents = streamCodingAgentModelToolLoop({
    request,
    ports: {
      modelCallPort: input.modelCallPort,
      toolCallHandler: input.toolRuntime,
      modelCallInputBuildService: input.modelCallInputBuildService,
      sourceOverrideProvider: input.sourceOverrideProvider,
      toolContinuationRecorder: {
        markToolContinuationEmitted: ({ request, stepId, toolResults, emittedAt, sequence }) => {
          const event = input.toolRuntime.markToolContinuationEmitted({
            request,
            stepId,
            toolResults,
            emittedAt,
            sequence,
          });
          return event ? [event] : [];
        },
      },
      ids: input.ids,
    },
    ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
    permissionMode: input.permissionMode ?? 'default',
    memoryRecall: {
      ...(input.memoryRecall?.memoryRecallSources ? { memoryRecallSources: input.memoryRecall.memoryRecallSources } : {}),
      ...(input.memoryRecall?.memoryRecallSeed ? { memoryRecallSeed: input.memoryRecall.memoryRecallSeed } : {}),
    },
    onPendingApproval: (pendingContinuation) => {
      pendingContinuations.push(pendingContinuation);
    },
  });

  return { request, modelEvents, pendingContinuations };
}
