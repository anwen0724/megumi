import { create } from 'zustand';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type {
  AgentMemoryAccessLogsListPayload,
  AgentMemoryAccessLogsListData,
  AgentMemoryCandidateAcceptData,
  AgentMemoryCandidateData,
  AgentMemoryCandidateListData,
  AgentMemoryCandidateListPayload,
  AgentMemoryData,
  AgentMemoryGetData,
  AgentMemoryListData,
  AgentMemoryListPayload,
  AgentMemoryRecallPreviewData,
  AgentMemoryRecallPreviewPayload,
  AgentMemorySettingsData,
} from '@megumi/shared/ipc-schemas';
import type {
  MemoryAccessLog,
  MemoryCandidate,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRecord,
  MemorySettings,
  MemorySourceRef,
} from '@megumi/shared/memory-contracts';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc/runtime-request';

interface RecallPreviewState {
  request: MemoryRecallRequest;
  results: MemoryRecallResult[];
}

interface MemoryState {
  settings?: MemorySettings;
  candidates: MemoryCandidate[];
  memories: MemoryRecord[];
  selectedMemory?: MemoryRecord;
  selectedSourceRefs: MemorySourceRef[];
  accessLogs: MemoryAccessLog[];
  recallPreview?: RecallPreviewState;
  loading: boolean;
  error?: string;
  loadSettings: (workspaceId: string) => Promise<void>;
  loadCandidates: (input: AgentMemoryCandidateListPayload) => Promise<void>;
  loadMemories: (input: AgentMemoryListPayload) => Promise<void>;
  getMemory: (memoryId: string) => Promise<void>;
  acceptCandidate: (candidateId: string, reviewedAt: string) => Promise<void>;
  rejectCandidate: (candidateId: string, rejectionReason: string, reviewedAt: string) => Promise<void>;
  archiveCandidate: (candidateId: string, reviewedAt: string) => Promise<void>;
  updateMemoryStatus: (
    operation: 'archive' | 'delete' | 'disable' | 'enable',
    memoryId: string,
    updatedAt: string,
  ) => Promise<void>;
  loadAccessLogs: (input: AgentMemoryAccessLogsListPayload) => Promise<void>;
  previewRecall: (input: AgentMemoryRecallPreviewPayload) => Promise<void>;
}

function memoryApi() {
  return window.megumi.agent.memory;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

async function applyResult<T>(
  promise: Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>,
): Promise<T> {
  const result = await promise;
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  candidates: [],
  memories: [],
  selectedSourceRefs: [],
  accessLogs: [],
  loading: false,
  async loadSettings(workspaceId) {
    set({ loading: true, error: undefined });
    try {
      const data = await applyResult<AgentMemorySettingsData>(memoryApi().settingsGet(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.memory.settingsGet, { workspaceId }),
      ));
      set({ settings: data.settings, loading: false });
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
    }
  },
  async loadCandidates(input) {
    set({ loading: true, error: undefined });
    try {
      const data = await applyResult<AgentMemoryCandidateListData>(memoryApi().candidateList(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.memory.candidateList, input),
      ));
      set({ candidates: data.candidates, loading: false });
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
    }
  },
  async loadMemories(input) {
    set({ loading: true, error: undefined });
    try {
      const data = await applyResult<AgentMemoryListData>(memoryApi().memoryList(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.memory.memoryList, input),
      ));
      set({ memories: data.memories, loading: false });
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
    }
  },
  async getMemory(memoryId) {
    set({ loading: true, error: undefined });
    try {
      const data = await applyResult<AgentMemoryGetData>(memoryApi().memoryGet(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.memory.memoryGet, { memoryId }),
      ));
      set({ selectedMemory: data.memory, selectedSourceRefs: data.sourceRefs, loading: false });
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
    }
  },
  async acceptCandidate(candidateId, reviewedAt) {
    await applyResult<AgentMemoryCandidateAcceptData>(memoryApi().candidateAccept(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.memory.candidateAccept, { candidateId, reviewedAt }),
    ));
    await get().loadCandidates({ status: 'proposed' });
  },
  async rejectCandidate(candidateId, rejectionReason, reviewedAt) {
    await applyResult<AgentMemoryCandidateData>(memoryApi().candidateReject(
      createRendererRuntimeIpcRequest(
        IPC_CHANNELS.agent.memory.candidateReject,
        { candidateId, rejectionReason, reviewedAt },
      ),
    ));
    await get().loadCandidates({ status: 'proposed' });
  },
  async archiveCandidate(candidateId, reviewedAt) {
    await applyResult<AgentMemoryCandidateData>(memoryApi().candidateArchive(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.memory.candidateArchive, { candidateId, reviewedAt }),
    ));
    await get().loadCandidates({ status: 'proposed' });
  },
  async updateMemoryStatus(operation, memoryId, updatedAt) {
    const input = { memoryId, updatedAt };
    if (operation === 'archive') {
      await applyResult<AgentMemoryData>(memoryApi().memoryArchive(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.memory.memoryArchive, input),
      ));
    }
    if (operation === 'delete') {
      await applyResult<AgentMemoryData>(memoryApi().memoryDelete(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.memory.memoryDelete, input),
      ));
    }
    if (operation === 'disable') {
      await applyResult<AgentMemoryData>(memoryApi().memoryDisable(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.memory.memoryDisable, input),
      ));
    }
    if (operation === 'enable') {
      await applyResult<AgentMemoryData>(memoryApi().memoryEnable(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.memory.memoryEnable, input),
      ));
    }
    await get().loadMemories({ status: 'active' });
  },
  async loadAccessLogs(input) {
    set({ loading: true, error: undefined });
    try {
      const data = await applyResult<AgentMemoryAccessLogsListData>(memoryApi().memoryAccessLogsList(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.memory.accessLogsList, input),
      ));
      set({ accessLogs: data.accessLogs, loading: false });
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
    }
  },
  async previewRecall(input) {
    set({ loading: true, error: undefined });
    try {
      const data = await applyResult<AgentMemoryRecallPreviewData>(memoryApi().recallPreview(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.memory.recallPreview, input),
      ));
      set({ recallPreview: data, loading: false });
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
    }
  },
}));
