// Composes AgentRunService repository ports from persistence owner repositories.
import type { AgentRunRepositoryPort } from '../run/run-contract';
import type { ModelStepRepository } from '../persistence/repos/model-step.repo';
import type { RunExecutionFactRepository } from '../persistence/repos/run-execution-fact.repo';
import type { RunRecordRepository } from '../persistence/repos/run-record.repo';
import type { RuntimeEventRepository } from '../persistence/repos/runtime-event.repo';
import type { SessionContextRepository } from '../persistence/repos/session-context.repo';
import type { SessionMessageRepository } from '../persistence/repos/session-message.repo';
import type { SessionRecordRepository } from '../persistence/repos/session-record.repo';

export interface AgentRunRepositoryPortCompositionInput {
  modelStepRepository: ModelStepRepository;
  runExecutionFactRepository: RunExecutionFactRepository;
  runRecordRepository: RunRecordRepository;
  runtimeEventRepository: RuntimeEventRepository;
  sessionContextRepository: SessionContextRepository;
  sessionMessageRepository: SessionMessageRepository;
  sessionRecordRepository: SessionRecordRepository;
}

export function createAgentRunRepositoryPort(
  input: AgentRunRepositoryPortCompositionInput,
): AgentRunRepositoryPort {
  return {
    saveSession: (session) => input.sessionRecordRepository.saveSession(session),
    getSession: (sessionId) => input.sessionRecordRepository.getSession(sessionId),
    saveMessage: (message) => input.sessionMessageRepository.saveMessage(message),
    getMessage: (messageId) => input.sessionMessageRepository.getMessage(messageId),
    saveRun: (run) => input.runRecordRepository.saveRun(run),
    getRun: (runId) => input.runRecordRepository.getRun(runId),
    listRunsByStatuses: (statuses) => input.runRecordRepository.listRunsByStatuses(statuses),
    saveStep: (step) => input.runExecutionFactRepository.saveStep(step),
    listStepsByRun: (runId) => input.runExecutionFactRepository.listStepsByRun(runId),
    saveAction: (action) => input.runExecutionFactRepository.saveAction(action),
    saveObservation: (observation) => input.runExecutionFactRepository.saveObservation(observation),
    saveModelStep: (modelStep) => input.modelStepRepository.saveModelStep(modelStep),
    getModelStep: (modelStepId) => input.modelStepRepository.getModelStep(modelStepId),
    getSessionCompaction: (compactionId) => input.sessionContextRepository.getSessionCompaction(compactionId),
    appendRuntimeEvent: (event) => input.runtimeEventRepository.appendRuntimeEvent(event),
    listRuntimeEventsByRun: (runId) => input.runtimeEventRepository.listRuntimeEventsByRun(runId),
  };
}
