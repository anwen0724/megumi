// Composes AgentRunService owner repository options from persistence repositories.
import type { AgentRunServiceOptions } from '../run/run-contract';
import type { ModelStepRepository } from '../persistence/repos/model-step.repo';
import type { RunExecutionFactRepository } from '../persistence/repos/run-execution-fact.repo';
import type { RunRecordRepository } from '../persistence/repos/run-record.repo';
import type { RuntimeEventRepository } from '../persistence/repos/runtime-event.repo';
import type { SessionContextRepository } from '../persistence/repos/session-context.repo';
import type { SessionMessageRepository } from '../persistence/repos/session-message.repo';
import type { SessionRecordRepository } from '../persistence/repos/session-record.repo';

export interface AgentRunRepositoryOptionsCompositionInput {
  modelStepRepository: ModelStepRepository;
  runExecutionFactRepository: RunExecutionFactRepository;
  runRecordRepository: RunRecordRepository;
  runtimeEventRepository: RuntimeEventRepository;
  sessionContextRepository: SessionContextRepository;
  sessionMessageRepository: SessionMessageRepository;
  sessionRecordRepository: SessionRecordRepository;
}

export type AgentRunRepositoryOptions = Pick<
  AgentRunServiceOptions,
  | 'sessionRepository'
  | 'messageRepository'
  | 'runRecordRepository'
  | 'runExecutionFactRepository'
  | 'modelStepRepository'
  | 'sessionContextRepository'
  | 'runtimeEventRepository'
>;

export function createAgentRunRepositoryOptions(
  input: AgentRunRepositoryOptionsCompositionInput,
): AgentRunRepositoryOptions {
  return {
    sessionRepository: input.sessionRecordRepository,
    messageRepository: input.sessionMessageRepository,
    runRecordRepository: input.runRecordRepository,
    runExecutionFactRepository: input.runExecutionFactRepository,
    modelStepRepository: input.modelStepRepository,
    sessionContextRepository: input.sessionContextRepository,
    runtimeEventRepository: input.runtimeEventRepository,
  };
}
