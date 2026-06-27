// Re-exports the model/tool loop entry points from the run loop package.
export {
  runModelToolLoop,
  type RunModelToolLoopInput,
} from '../loop';

export type {
  ToolCallHandlerPort,
  ToolCallHandlerOutcome,
  ToolApprovalResumeInput,
  ToolApprovalResumeOutcome,
  ToolApprovalResumePort,
  PendingToolApproval,
  PendingToolApprovalContinuation,
} from './tool-call-contract';
