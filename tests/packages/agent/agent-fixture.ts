/* Builds an isolated AI provider at the external model boundary. */
import { createModels, fauxAssistantMessage, fauxProvider } from '@megumi/ai';
import { createAgent, type AgentConfig, type CreateAgentRequest } from '@megumi/agent';
export function fixture(options: Omit<CreateAgentRequest, 'ai'> = {}) {
  const ai = createModels();
  const provider = fauxProvider();
  provider.setResponses([fauxAssistantMessage('Done.')]);
  ai.setProvider(provider.provider);
  const model = ai.getModels()[0];
  if (!model) throw new Error('Fixture model missing.');
  const config: AgentConfig = {
    model, tools: [], permissionMode: 'auto',
    policy: {
      maxModelCallsPerExecution: 4, maxToolRoundsPerExecution: 3,
      maxToolCallsPerModelCall: 4, maxToolCallsPerExecution: 8,
      maxConcurrentToolExecutions: 2, modelCallTimeoutMs: 1000,
      toolExecutionTimeoutMs: 1000, maxModelCallAttempts: 1,
      modelRetryDelayMs: 0, maxContextOverflowRecoveries: 0,
      providerRequestMaxRetries: 0, providerRequestMaxRetryDelayMs: 0,
    },
  };
  return { ai, agent: createAgent({ ai, ...options }), config, provider };
}


export function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
