import { Sparkles } from 'lucide-react';
import type { RecoverableRunSummary } from '@megumi/shared/recovery-contracts';
import { ApprovalCard, type ApprovalCardResolvePayload } from '../../../entities/approval';
import { useProjectStore } from '../../../entities/project/store';
import { Button } from '../../../shared/ui';
import { Composer, type ComposerSubmitPayload } from './Composer';
import { TimelineMessage } from './TimelineMessage';
import { WorkspaceChangeFooter } from './WorkspaceChangeFooter';
import { useTimelineAutoScroll } from '../hooks/use-timeline-auto-scroll';
import { useChatPageController, recoverableActionsFor } from '../hooks/use-chat-page-controller';

const CHAT_CONTENT_COLUMN_CLASS = 'mx-auto w-full max-w-3xl';

function RecoverableRunActions({
  run,
  pending,
  onRetry,
  onRerun,
  onMarkCancelled,
}: {
  run: RecoverableRunSummary;
  pending: boolean;
  onRetry: (run: RecoverableRunSummary) => void;
  onRerun: (run: RecoverableRunSummary) => void;
  onMarkCancelled: (run: RecoverableRunSummary) => void;
}) {
  const actions = recoverableActionsFor(run);
  if (actions.length === 0) return null;

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2 text-xs"
      aria-label={`Recoverable actions for ${run.title ?? run.runId}`}
    >
      {actions.includes('retry') ? (
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => onRetry(run)}>
          Retry
        </Button>
      ) : null}
      {actions.includes('rerun') ? (
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => onRerun(run)}>
          Rerun
        </Button>
      ) : null}
      {actions.includes('mark_cancelled') ? (
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => onMarkCancelled(run)}>
          Mark cancelled
        </Button>
      ) : null}
    </div>
  );
}

export function ChatTimeline() {
  const ctrl = useChatPageController();
  const timelineScroll = useTimelineAutoScroll({
    sessionKey: ctrl.activeChatStreamSessionKey,
    updateKey: ctrl.timelineUpdateKey,
  });

  return (
    <main
      data-testid="chat-timeline-root"
      className="relative flex min-w-[42rem] flex-1 flex-col overflow-hidden bg-[var(--color-app-bg)] transition-[background-color] duration-200 ease-out"
    >
      <div
        ref={timelineScroll.scrollRef}
        data-testid="chat-message-scroll-area"
        tabIndex={0}
        onScroll={timelineScroll.onScroll}
        onWheel={timelineScroll.onWheel}
        onPointerDown={timelineScroll.onPointerDown}
        onKeyDown={timelineScroll.onKeyDown}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {ctrl.hasTimelineContent ? (
          <div data-testid="chat-message-content-column" className={`${CHAT_CONTENT_COLUMN_CLASS} pb-3 pt-7`}>
            <div role="log" aria-label="Chat timeline" className="flex w-full flex-col gap-5">
              {ctrl.timelineMessages.map((message) => (
                <TimelineMessage
                  key={message.messageId}
                  message={message}
                  showUserActions={ctrl.canShowUserMessageActions(message)}
                  afterContent={message.role === 'assistant' ? (
                    <>
                      {message.workspaceChangeFooter ? (
                        <WorkspaceChangeFooter
                          footer={message.workspaceChangeFooter}
                          pendingChangeSetIds={ctrl.pendingWorkspaceChangeSetIds}
                          onOpenFile={(projectPath) => {
                            void ctrl.openWorkspaceChangedFile(projectPath);
                          }}
                          onRestoreChangeSet={(changeSetId) => {
                            void ctrl.restoreWorkspaceChangeSet(changeSetId);
                          }}
                        />
                      ) : null}
                      {message.runId && ctrl.recoverableRunsByRunId.has(message.runId) ? (
                        <RecoverableRunActions
                          run={ctrl.recoverableRunsByRunId.get(message.runId)!}
                          pending={ctrl.pendingRecoverableRunIds.has(message.runId)}
                          onRetry={(run) => {
                            void ctrl.retryRecoverableRun(run);
                          }}
                          onRerun={(run) => {
                            void ctrl.rerunRecoverableRun(run);
                          }}
                          onMarkCancelled={(run) => {
                            void ctrl.markRecoverableRunCancelled(run);
                          }}
                        />
                      ) : null}
                    </>
                  ) : null}
                  onBranchFromMessage={(timelineMessage) => {
                    void ctrl.createBranchDraft({ messageId: timelineMessage.messageId, intent: 'branch' });
                  }}
                  onRerunMessage={(timelineMessage) => {
                    void ctrl.createBranchDraft({ messageId: timelineMessage.messageId, intent: 'rerun' });
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <div data-testid="chat-message-content-column" className={`${CHAT_CONTENT_COLUMN_CLASS} flex h-full items-center justify-center`}>
            <div className="flex h-full items-center justify-center">
              <div className="max-w-md text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-accent)]">
                  <Sparkles size={24} aria-hidden="true" />
                </div>
                <h1 className="text-xl font-semibold text-[var(--color-text)]">Welcome to Megumi</h1>
                {ctrl.currentProjectId === null ? (
                  <>
                    <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                      Open a workspace to get started.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void useProjectStore.getState().useExistingProject();
                      }}
                      className="mt-4 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                    >
                      Open workspace
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                      Megumi is ready to help with this workspace.
                    </p>
                    {ctrl.currentProject ? (
                      <div className="mt-4 flex flex-col items-center gap-2 text-sm">
                        <div
                          aria-label={`New session project: ${ctrl.currentProject.name}`}
                          className="relative inline-flex items-center gap-2 text-[var(--color-text)]"
                        >
                          <span className="text-[var(--color-text-muted)]">New session in</span>
                          <span className="font-medium">{ctrl.currentProject.name}</span>
                          {ctrl.canChangeNewSessionProject ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => ctrl.setProjectPickerOpen((value) => !value)}
                            >
                              Change project
                            </Button>
                          ) : null}

                          {ctrl.projectPickerOpen && ctrl.canChangeNewSessionProject ? (
                            <div
                              role="menu"
                              aria-label="Select project for new session"
                              className="absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-left shadow-[var(--shadow-soft)]"
                            >
                              {ctrl.projects.map((project) => {
                                const isCurrent = project.id === ctrl.currentProjectId;
                                return (
                                  <button
                                    key={project.id}
                                    type="button"
                                    role="menuitem"
                                    aria-label={`Use project ${project.name} for this new session`}
                                    disabled={isCurrent}
                                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-sm text-[var(--color-text)] transition hover:bg-[var(--color-surface)] disabled:cursor-default disabled:bg-[var(--color-accent-soft)] disabled:text-[var(--color-text)]"
                                    onClick={() => {
                                      void ctrl.switchNewSessionProject(project.id);
                                    }}
                                  >
                                    <span className="min-w-0 truncate">{project.name}</span>
                                    {isCurrent ? (
                                      <span className="shrink-0 text-xs text-[var(--color-text-muted)]">Current</span>
                                    ) : null}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                        <p className="max-w-md truncate text-sm text-[var(--color-text-muted)]">
                          {ctrl.currentProject.repoPath}
                        </p>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div data-testid="chat-composer-dock" className="shrink-0 bg-[var(--color-app-bg)]">
        <div data-testid="chat-composer-content-column" className={CHAT_CONTENT_COLUMN_CLASS}>
          {ctrl.pendingApprovals.length > 0 ? (
            <section
              aria-label="Blocking approval controls"
              aria-live="polite"
              aria-atomic="true"
              className="mb-3 space-y-2"
            >
              {ctrl.pendingApprovals.map((request) => (
                <ApprovalCard
                  key={request.approvalRequestId}
                  request={request}
                  onResolve={(payload) => {
                    void ctrl.resolveApproval(payload);
                  }}
                />
              ))}
            </section>
          ) : null}
          {ctrl.unmatchedRecoverableRuns.length > 0 ? (
            <section
              aria-label="Recoverable run fallback actions"
              className="mb-3 space-y-2"
            >
              {ctrl.unmatchedRecoverableRuns.map((run) => (
                <RecoverableRunActions
                  key={run.runId}
                  run={run}
                  pending={ctrl.pendingRecoverableRunIds.has(run.runId)}
                  onRetry={(recoverableRun) => {
                    void ctrl.retryRecoverableRun(recoverableRun);
                  }}
                  onRerun={(recoverableRun) => {
                    void ctrl.rerunRecoverableRun(recoverableRun);
                  }}
                  onMarkCancelled={(recoverableRun) => {
                    void ctrl.markRecoverableRunCancelled(recoverableRun);
                  }}
                />
              ))}
            </section>
          ) : null}
          <Composer
            status={ctrl.composerStatus}
            branchDraft={ctrl.branchDraft ? {
              key: ctrl.branchDraft.branchMarkerId,
              label: ctrl.branchDraft.label,
              seedText: ctrl.branchDraft.seedText,
              onCancel: () => {
                void ctrl.cancelBranchDraft();
              },
            } : null}
            onSubmit={ctrl.handleSubmit}
            onStop={ctrl.handleStop}
            onAttachFiles={() => undefined}
            onChooseContext={() => undefined}
          />
        </div>
      </div>

      {ctrl.restoreFeedback ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-8">
          <div
            role="status"
            aria-label="撤销结果"
            aria-live="polite"
            className="pointer-events-auto w-full max-w-sm rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4 text-sm text-[var(--color-text)] shadow-[var(--shadow-soft)]"
          >
            <div className="font-medium leading-6">{ctrl.restoreFeedback.title}</div>
            <div className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
              {ctrl.restoreFeedback.description}
            </div>
            {ctrl.restoreFeedback.persistent ? (
              <div className="mt-3 flex justify-end">
                <Button type="button" variant="secondary" size="sm" onClick={() => ctrl.setRestoreFeedback(null)}>
                  关闭
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
