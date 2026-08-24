/* Owns the headless Evaluation composition root and projects it through Product Host contracts. */
import { createDiscoveryAgent } from '@megumi/discovery-agent';
import {
  composeProduct,
  composeProductCapabilities,
  type ProductCapabilitiesInput as ProductCapabilitiesOptions,
} from '../../../apps/desktop/src/main/shell-composition/application-host-composition';
import type { ProductRuntime } from '../../../apps/desktop/src/main/shell-composition/application-runtime';
import type { AnyEvent as RuntimeEvent } from '@megumi/product/host';
import type { BuiltInToolAvailability } from '@megumi/tools';
import {
  createEvaluationHomeOptions,
  createEvaluationInputSourceAccess,
  createNodeSettingsEnvironment,
  getNodeProductEnvironment,
  nodeObservabilityStorage,
  nodeSessionAttachmentFileSystem,
} from '../adapters/node-product-host-adapters';
import type {
  EvaluationChatHost,
  EvaluationHost,
  EvaluationProductRuntimeFactory,
} from './evaluation-runner';

export interface ComposeProductEvaluationFactoryOptions {
  credential?: string;
  requireCredential?: boolean;
  webSearch?: {
    provider: 'brave' | 'tavily' | 'exa' | 'custom';
    credential: string;
    baseUrl?: string;
  };
  productOverrides?: Partial<Omit<
    ProductCapabilitiesOptions,
    'home' | 'directoryPicker' | 'workspaceFileSystem' | 'builtInToolAvailability' | 'observabilityStorage' | 'settingsEnvironment' | 'productEnvironment'
  >>;
}

export function createComposeProductEvaluationFactory(
  options: ComposeProductEvaluationFactoryOptions = {},
): EvaluationProductRuntimeFactory {
  return {
    async create(input) {
      if (options.requireCredential !== false && !options.credential) {
        throw new Error(`Provider credential is required for Evaluation target ${input.target.targetId}.`);
      }
      const builtInToolAvailability: BuiltInToolAvailability = {
        isAvailable: ({ toolName }) => input.isBuiltInToolAvailable(toolName),
      };
      // Evaluation selects its Node adapters, then composes the shared Harness and Discovery Agent.
      const capabilities = composeProductCapabilities({
        ...options.productOverrides,
        home: createEvaluationHomeOptions(input.homeRoot),
        observabilityStorage: nodeObservabilityStorage,
        inputSourceAccess: createEvaluationInputSourceAccess(input.workspaceRoot),
        workspaceFileSystem: input.workspaceFileSystem,
        sessionAttachmentFileSystem: nodeSessionAttachmentFileSystem,
        builtInToolAvailability,
        settingsEnvironment: createNodeSettingsEnvironment(),
        productEnvironment: getNodeProductEnvironment(),
      });
      const discoveryAgent = createDiscoveryAgent(capabilities.discoveryAgentOptions);
      const product = composeProduct({
        capabilities,
        discoveryAgent,
        directoryPicker: {
          chooseDirectory: async () => ({ canceled: false, filePaths: [input.workspaceRoot] }),
        },
      });
      const runtimeEvents = createRuntimeEventStream(product);

      try {
        await configureTarget(
          product.host,
          input.target.providerId,
          input.target.modelId,
          input.profile.permissionMode,
          options.credential,
          options.webSearch,
        );
        return {
          host: createEvaluationHost(product, runtimeEvents),
          dispose: async () => {
            runtimeEvents.close();
            await product.dispose();
          },
        };
      } catch (error) {
        runtimeEvents.close();
        await product.dispose();
        throw error;
      }
    },
  };
}

/**
 * Adapts the current Product Host seam into the Host surface the Evaluation
 * runner drives: Session operations plus a live Runtime Event stream. The
 * runner never constructs the Product itself.
 */
function createEvaluationHost(
  product: ProductRuntime,
  runtimeEvents: RuntimeEventStream,
): EvaluationHost {
  const chat: EvaluationChatHost = {
    createSession(request) {
      return product.host.session.createSession({
        projectId: request.projectId,
        ...(request.title ? { title: request.title } : {}),
      });
    },
    async sendUserInput(request) {
      const result = await product.host.session.sendUserInput(request);
      return { payload: result.payload, events: runtimeEvents.stream };
    },
    async cancelUserInput(request) {
      const result = await product.host.session.cancelUserInput(request);
      return { payload: result.payload, events: runtimeEvents.stream };
    },
    async listMessages({ sessionId }) {
      const read = await product.host.session.readSession({ sessionId });
      return read.status === 'ok'
        ? { status: 'ok' as const, messages: [...read.conversation] }
        : {
            status: 'failed' as const,
            failure: {
              message: read.status === 'not_found'
                ? `Session ${read.sessionId} was not found.`
                : read.failure.message,
            },
          };
    },
    async listTimeline({ sessionId }) {
      const read = await product.host.session.readSession({ sessionId });
      return { messages: read.status === 'ok' ? [...read.conversation] : [] };
    },
  };

  return {
    workspace: { useExistingProject: product.host.workspace.useExistingProject },
    chat,
    approval: {
      async resolve(request) {
        const result = await product.host.approval.resolve(request);
        return { payload: result.payload, events: runtimeEvents.stream };
      },
    },
    settings: { get: product.host.settings.get },
    skill: { listSkills: product.host.skill.listSkills },
    observability: {
      getRunTrace: product.host.observability.getRunTrace,
      flush: product.host.observability.flush,
    },
  };
}

interface RuntimeEventStream {
  readonly stream: AsyncIterable<RuntimeEvent>;
  close(): void;
}

/** Buffers live Runtime Events into the single iterable stream the runner consumes. */
function createRuntimeEventStream(product: ProductRuntime): RuntimeEventStream {
  const queue: RuntimeEvent[] = [];
  const waiters = new Set<() => void>();
  let closed = false;
  const wakeAll = () => {
    for (const wake of [...waiters]) wake();
    waiters.clear();
  };
  const subscription = product.subscribeRuntimeEvents({}, (event) => {
    if (closed) return;
    queue.push(event);
    wakeAll();
  });
  const stream: AsyncIterable<RuntimeEvent> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<RuntimeEvent>> {
          while (!closed && queue.length === 0) {
            await new Promise<void>((resolve) => { waiters.add(resolve); });
          }
          const value = queue.shift();
          return value ? { done: false, value } : { done: true, value: undefined };
        },
        async return(): Promise<IteratorResult<RuntimeEvent>> {
          closed = true;
          wakeAll();
          return { done: true, value: undefined };
        },
      };
    },
  };
  return {
    stream,
    close() {
      if (closed) return;
      closed = true;
      subscription.unsubscribe();
      wakeAll();
    },
  };
}

async function configureTarget(
  host: ReturnType<typeof composeProduct>['host'],
  providerId: string,
  modelId: string,
  permissionMode: 'ask' | 'auto' | 'full_access',
  credential?: string,
  webSearch?: ComposeProductEvaluationFactoryOptions['webSearch'],
): Promise<void> {
  const providers = await host.settings.listProviders();
  if (providers.status !== 'ok') throw new Error(providers.failure.message);
  const catalog = providers.catalog.find((item) => item.providerId === providerId);
  const catalogModel = catalog?.models.find((item) => item.modelId === modelId);
  const existing = providers.providers.find((item) => item.providerId === providerId);
  if (!catalog && !existing) throw new Error(`Unknown Provider for Evaluation target: ${providerId}`);
  if (catalog && !catalogModel) throw new Error(`Unknown model for Evaluation target: ${providerId}/${modelId}`);

  const updated = await host.settings.updateProvider({
    providerId,
    enabled: true,
    ...(catalog ? {
      protocol: catalog.protocol,
      displayName: catalog.displayName,
      baseUrl: catalog.defaultBaseUrl,
      modelIds: [modelId],
      models: catalogModel ? [{
        modelId,
        displayName: catalogModel.displayName,
        contextWindowTokens: catalogModel.contextWindowTokens,
        imageInput: catalogModel.capabilities.imageInput,
      }] : undefined,
    } : { modelIds: [modelId] }),
  });
  if (updated.status === 'failed') throw new Error(updated.failure.message);
  if (credential) {
    const credentialResult = await host.settings.setProviderApiKey({ providerId, apiKey: credential });
    if (credentialResult.status === 'failed') throw new Error(credentialResult.failure.message);
  }
  const settings = await host.settings.update({
    modelSelection: { providerId, modelId },
    permissions: { mode: permissionMode },
    ...(webSearch ? {
      web: {
        search: {
          provider: webSearch.provider,
          apiKey: webSearch.credential,
          ...(webSearch.baseUrl ? { baseUrl: webSearch.baseUrl } : {}),
        },
      },
    } : {}),
  });
  if (settings.status === 'failed') throw new Error(settings.failure.message);
}
