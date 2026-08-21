/* Guards the stable public Agent package surface independently from its internal modules. */
import { describe, expect, it } from 'vitest';
import * as agentPackage from '@megumi/agent';
import type {
  AgentConfiguration,
  AgentConfigurationPatch,
  AgentContext,
  AgentContextProvider,
  AgentError,
  AgentEvent,
  AgentEventListener,
  AgentExecutionEvent,
  AgentExecutionOptions,
  AgentExecutionPhase,
  AgentExecutionResult,
  AgentExecutionState,
  AgentMessage,
  AgentOperationErrorCode,
  AgentOptions,
  AgentPolicy,
  AgentSettlement,
  AgentState,
  AgentStreamFunction,
  AgentTool,
  AgentToolCall,
  AgentToolExecutionOutcome,
  AgentToolResult,
} from '@megumi/agent';

type PublicTypes =
  | AgentConfiguration
  | AgentConfigurationPatch
  | AgentContext
  | AgentContextProvider
  | AgentError
  | AgentEvent
  | AgentEventListener
  | AgentExecutionEvent
  | AgentExecutionOptions
  | AgentExecutionPhase
  | AgentExecutionResult
  | AgentExecutionState
  | AgentMessage
  | AgentOperationErrorCode
  | AgentOptions
  | AgentPolicy
  | AgentSettlement
  | AgentState
  | AgentStreamFunction
  | AgentTool
  | AgentToolCall
  | AgentToolExecutionOutcome
  | AgentToolResult;

describe('@megumi/agent public contract', () => {
  it('exports only the two public runtime behaviors', () => {
    expect(Object.keys(agentPackage).sort()).toEqual(['Agent', 'AgentOperationError']);
  });

  it('keeps the complete shared type surface importable', () => {
    expectTypeOnly<PublicTypes>();
  });
});

function expectTypeOnly<T>(): void {
  const compileTimeOnly = undefined as T | undefined;
  expect(compileTimeOnly).toBeUndefined();
}
