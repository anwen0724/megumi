/* Binds the Character renderer to the selected Session's canonical Timeline and existing Agent operations. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ToolApprovalResolvePayload, ToolApprovalResolveResult } from '../../entities/approval';
import { useRunStore } from '../../entities/run';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';
import {
  sessionTimelineKey,
  sessionTimelineSynchronizer,
  useSessionTimelineStore,
} from '../session-timeline';
import { projectCurrentInteraction } from './current-interaction';

const EMPTY_MESSAGES = [] as const;

export function useCharacterInteraction(selectedSessionId: string | null) {
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    sessionTimelineSynchronizer.start();
    return () => sessionTimelineSynchronizer.stop();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let synchronizedProjectId: string | null = null;
    if (!selectedSessionId) {
      setProjectId(null);
      sessionTimelineSynchronizer.clearActiveSession();
      return undefined;
    }
    void window.megumi.session.list(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.session.sessionList, {}),
    ).then((result) => {
      if (cancelled || !result.ok || result.data.status !== 'ok') return;
      const session = result.data.sessions.find((candidate) => candidate.id === selectedSessionId);
      if (!session) return;
      synchronizedProjectId = session.projectId;
      setProjectId(session.projectId);
      sessionTimelineSynchronizer.setActiveSession(session.projectId, selectedSessionId);
    });
    return () => {
      cancelled = true;
      if (synchronizedProjectId) {
        sessionTimelineSynchronizer.clearActiveSession(synchronizedProjectId, selectedSessionId);
      }
    };
  }, [selectedSessionId]);

  const messages = useSessionTimelineStore((state) => {
    if (!projectId || !selectedSessionId) return EMPTY_MESSAGES;
    return state.sessions[sessionTimelineKey(projectId, selectedSessionId)]?.messages ?? EMPTY_MESSAGES;
  });
  const interaction = useMemo(() => projectCurrentInteraction(messages), [messages]);
  const runStatus = useRunStore((state) => interaction ? state.runs[interaction.runId]?.status : undefined);
  const activeRunId = interaction && (runStatus === 'running' || runStatus === 'waiting' || runStatus === 'cancelling')
    ? interaction.runId
    : undefined;

  const resolveApproval = useCallback(async (
    payload: ToolApprovalResolvePayload,
  ): Promise<ToolApprovalResolveResult> => {
    const result = await window.megumi.approval.resolve(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.approval.resolve,
      payload,
    ));
    if (!result.ok) return { status: 'failed', message: result.data.message };
    if (isApprovalResolveFailed(result.data)) {
      return { status: 'failed', message: result.data.failure.message };
    }
    return { status: 'accepted' };
  }, []);

  const cancelRun = useCallback(async (): Promise<boolean> => {
    if (!activeRunId) return false;
    const result = await window.megumi.session.message.cancel(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.session.sessionMessageCancel,
      { runId: activeRunId },
    ));
    return Boolean(result.ok && result.data.status === 'cancellation_requested');
  }, [activeRunId]);

  return { projectId, interaction, activeRunId, runStatus, resolveApproval, cancelRun };
}

function isApprovalResolveFailed(value: unknown): value is {
  status: 'failed';
  failure: { message: string };
} {
  return Boolean(
    value
    && typeof value === 'object'
    && 'status' in value
    && (value as { status?: unknown }).status === 'failed'
    && 'failure' in value
    && typeof (value as { failure?: { message?: unknown } }).failure?.message === 'string'
  );
}
