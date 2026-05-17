import { create } from 'zustand';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type {
  MemoryAccessLogsListPayload,
  MemoryAccessLogsListData,
  MemoryCandidateAcceptData,
  MemoryCandidateData,
  MemoryCandidateListData,
  MemoryCandidateListPayload,
  MemoryData,
  MemoryGetData,
  MemoryListData,
  MemoryListPayload,
  MemoryRecallPreviewData,
  MemoryRecallPreviewPayload,
  MemorySettingsData,
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
  loadCandidates: (input: MemoryCandidateListPayload) => Promise<void>;
  loadMemories: (input: MemoryListPayload) => Promise<void>;
  getMemory: (memoryId: string) => Promise<void>;
  acceptCandidate: (candidateId: string, reviewedAt: string) => Promise<void>;
  rejectCandidate: (candidateId: string, rejectionReason: string, reviewedAt: string) => Promise<void>;
  archiveCandidate: (candidateId: string, reviewedAt: string) => Promise<void>;
  updateMemoryStatus: (
    operation: 'archive' | 'delete' | 'disable' | 'enable',
    memoryId: string,
    updatedAt: string,
  ) => Promise<void>;
  loadAccessLogs: (input: MemoryAccessLogsListPayload) => Promise<void>;
  previewRecall: (input: MemoryRecallPreviewPayload) => Promise<void>;
}

function memoryApi() {
  return window.megumi.memory;
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
      const data = await applyResult<MemorySettingsData>(memoryApi().settingsGet(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.memory.settingsGet, { workspaceId }),
      ));
      set({ settings: data.settings, loading: false });
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
    }
  },
  async loadCandidates(input) {
    set({ loading: true, error: undefined });
    try {
      const data = await applyResult<MemoryCandidateListData>(memoryApi().candidateList(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.memory.candidateList, input),
      ));
      set({ candidates: data.candidates, loading: false });
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
    }
  },
  async loadMemories(input) {
    set({ loading: true, error: undefined });
    try {
      const data = await applyResult<MemoryListData>(memoryApi().memoryList(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.memory.memoryList, input),
      ));
      set({ memories: data.memories, loading: false });
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
    }
  },
  async getMemory(memoryId) {
    set({ loading: true, error: undefined });
    try {
      const data = await applyResult<MemoryGetData>(memoryApi().memoryGet(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.memory.memoryGet, { memoryId }),
      ));
      set({ selectedMemory: data.memory, selectedSourceRefs: data.sourceRefs, loading: false });
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
    }
  },
  async acceptCandidate(candidateId, reviewedAt) {
    await applyResult<MemoryCandidateAcceptData>(memoryApi().candidateAccept(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.memory.candidateAccept, { candidateId, reviewedAt }),
    ));
    await get().loadCandidates({ status: 'proposed' });
  },
  async rejectCandidate(candidateId, rejectionReason, reviewedAt) {
    await applyResult<MemoryCandidateData>(memoryApi().candidateReject(
      createRendererRuntimeIpcRequest(
        IPC_CHANNELS.memory.candidateReject,
        { candidateId, rejectionReason, reviewedAt },
      ),
    ));
    await get().loadCandidates({ status: 'proposed' });
  },
  async archiveCandidate(candidateId, reviewedAt) {
    await applyResult<MemoryCandidateData>(memoryApi().candidateArchive(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.memory.candidateArchive, { candidateId, reviewedAt }),
    ));
    await get().loadCandidates({ status: 'proposed' });
  },
  async updateMemoryStatus(operation, memoryId, updatedAt) {
    const input = { memoryId, updatedAt };
    if (operation === 'archive') {
      await applyResult<MemoryData>(memoryApi().memoryArchive(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.memory.memoryArchive, input),
      ));
    }
    if (operation === 'delete') {
      await applyResult<MemoryData>(memoryApi().memoryDelete(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.memory.memoryDelete, input),
      ));
    }
    if (operation === 'disable') {
      await applyResult<MemoryData>(memoryApi().memoryDisable(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.memory.memoryDisable, input),
      ));
    }
    if (operation === 'enable') {
      await applyResult<MemoryData>(memoryApi().memoryEnable(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.memory.memoryEnable, input),
      ));
    }
    await get().loadMemories({ status: 'active' });
  },
  async loadAccessLogs(input) {
    set({ loading: true, error: undefined });
    try {
      const data = await applyResult<MemoryAccessLogsListData>(memoryApi().memoryAccessLogsList(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.memory.accessLogsList, input),
      ));
      set({ accessLogs: data.accessLogs, loading: false });
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
    }
  },
  async previewRecall(input) {
    set({ loading: true, error: undefined });
    try {
      const data = await applyResult<MemoryRecallPreviewData>(memoryApi().recallPreview(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.memory.recallPreview, input),
      ));
      set({ recallPreview: data, loading: false });
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
    }
  },
}));
