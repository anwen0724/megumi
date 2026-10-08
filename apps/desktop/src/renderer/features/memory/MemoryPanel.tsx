/* Presents durable memory status, bounded documents and explicit maintenance actions. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  MemoryStatus,
  MemoryManagedSource,
  MemoryRun,
} from '@megumi/application/memory/contracts';
import { ChevronLeft, PanelRightClose, RefreshCw } from 'lucide-react';
import type { MemoryDocumentSlice } from '@megumi/application/memory/memory-files';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest as request } from '../../shared/ipc';
import { Button, IconButton } from '../../shared/ui';
import { TimelineMarkdown } from '../chat/components/TimelineMarkdown';
import { memoryReadingText, sourceMessageText } from './memory-presentation';
import type { MemoryDocumentTarget } from './memory-panel-navigation';
import { useSessionStore } from '../../entities/session/store';
import { useProjectStore } from '../../entities/project/store';

type View = 'content' | 'sources' | 'activity';

type DocumentItem = {
  path: string;
  version: string;
  readOnly: boolean;
};

type SourcePage = Extract<
  Awaited<ReturnType<Window['megumi']['memory']['readSource']>>,
  {
    ok: true;
  }
>['data'];

/** Opens management without starting model work; only explicit actions can generate. */
export function MemoryPanel({
  onClose,
  onBack,
  onOpenSettings,
  initialDocument,
}: {
  onClose: () => void;
  onBack?: () => void;
  onOpenSettings?: () => void;
  initialDocument?: MemoryDocumentTarget;
}) {
  const { t } = useTranslation('settings');
  const [view, setView] = useState<View>('content');
  const [status, setStatus] = useState<MemoryStatus>();

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [documentCursor, setDocumentCursor] = useState<string>();
  const [sources, setSources] = useState<readonly MemoryManagedSource[]>([]);
  const [sourceCursor, setSourceCursor] = useState<string>();
  const [selected, setSelected] = useState(initialDocument?.path ?? '');
  const [documentTarget, setDocumentTarget] = useState(initialDocument);
  const previousDocument = useRef(initialDocument);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<() => void>();

  function navigate(next: () => void) {
    if (draftOpen) setPendingNavigation(() => next);
    else next();
  }

  useEffect(() => {
    if (initialDocument === previousDocument.current) return;

    previousDocument.current = initialDocument;
    if (!initialDocument) return;

    navigate(() => {
      setDraftOpen(false);
      setDocumentTarget(initialDocument);
      setSelected(initialDocument.path);
      setView('content');
    });
  }, [initialDocument]);

  const [clearOpen, setClearOpen] = useState(false);
  const [source, setSource] = useState<{
    ref: string;
    page: SourcePage;
  }>();
  const eventCursor = useRef<
    | {
        processInstanceId: string;
        sequence: number;
      }
    | undefined
  >(undefined);
  const queryRevision = useRef(0);
  const load = useCallback(async () => {
    const revision = ++queryRevision.current;

    try {
      const [memory, files, origins] = await Promise.all([
        window.megumi.memory.getStatus(request(IPC_CHANNELS.memory.getStatus, {})),
        window.megumi.memory.listDocuments(request(IPC_CHANNELS.memory.listDocuments, {})),
        window.megumi.memory.listSources(request(IPC_CHANNELS.memory.listSources, {})),
      ]);
      if (queryRevision.current !== revision) return;
      if (!memory.ok) throw new Error(memory.data.message);
      if (!files.ok) throw new Error(files.data.message);
      if (!origins.ok) throw new Error(origins.data.message);

      if (memory.data.status === 'ok') setStatus(memory.data.memory);
      if (files.data.status === 'ok') {
        setDocuments([...files.data.documents]);
        setDocumentCursor(files.data.nextCursor);
      }

      if (origins.data.status === 'ok') {
        setSources(origins.data.sources);
        setSourceCursor(origins.data.nextCursor);
      }
    } catch (error) {
      if (queryRevision.current === revision) setError(String(error));
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = window.megumi.memory.onChanged(event => {
      const previous = eventCursor.current;
      if (
        previous?.processInstanceId === event.processInstanceId &&
        previous.sequence >= event.sequence
      )
        return;

      eventCursor.current = event;
      void load();
    });
    return () => {
      queryRevision.current++;
      unsubscribe();
    };
  }, [load]);

  /** Displays domain errors while leaving editor drafts untouched during refresh. */
  async function action(
    operation: () => Promise<{
      ok: boolean;
      data: unknown;
    }>,
  ) {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const result = await operation();
      if (!result.ok) {
        const data = result.data;
        throw new Error(
          typeof data === 'object' && data && 'message' in data
            ? String(data.message)
            : t('memory.failed'),
        );
      }

      await load();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function moreDocuments() {
    const result = await window.megumi.memory.listDocuments(
      request(IPC_CHANNELS.memory.listDocuments, {
        cursor: documentCursor,
      }),
    );
    if (!result.ok) throw new Error(result.data.message);
    if (result.data.status === 'ok') {
      setDocuments(items => [...items, ...result.data.documents]);
      setDocumentCursor(result.data.nextCursor);
    }

    return result;
  }

  async function moreSources() {
    const result = await window.megumi.memory.listSources(
      request(IPC_CHANNELS.memory.listSources, {
        cursor: sourceCursor,
      }),
    );
    if (!result.ok) throw new Error(result.data.message);
    if (result.data.status === 'ok') {
      setSources(items => [...items, ...result.data.sources]);
      setSourceCursor(result.data.nextCursor);
    }
  }

  async function openSource(sourceRef: string, cursor?: string) {
    const result = await window.megumi.memory.readSource(
      request(IPC_CHANNELS.memory.readSource, {
        sourceRef,
        cursor,
      }),
    );
    if (!result.ok) throw new Error(result.data.message);

    setSource(previous => {
      const page = result.data;
      if (
        !cursor ||
        previous?.ref !== sourceRef ||
        previous.page.status !== 'found' ||
        page.status !== 'found'
      )
        return {
          ref: sourceRef,
          page,
        };

      const messages = [...previous.page.messages];
      for (const message of page.messages) {
        const last = messages.at(-1);
        if (last?.messageId === message.messageId && last.truncated) {
          messages[messages.length - 1] = {
            ...message,
            characterOffset: last.characterOffset,
            text: last.text + message.text,
          };
        } else messages.push(message);
      }

      return {
        ref: sourceRef,
        page: {
          ...page,
          messages,
        },
      };
    });
  }

  const mainDocument =
    documents.find(item => item.path === 'MEMORY.md') ??
    documents.find(item => item.path === 'memory_summary.md');
  const selectedPath = selected || mainDocument?.path;
  const relatedDocuments = documents.filter(
    item => item.path.startsWith('skills/') && item.path.endsWith('/SKILL.md'),
  );

  function showView(next: View) {
    navigate(() => {
      setDraftOpen(false);
      setSource(undefined);
      setView(next);
    });
  }

  const pending = status?.artifactState === 'updating' || status?.artifactState === 'clearing';
  const running =
    status?.recentRuns.filter(run => ['pending', 'running'].includes(run.status)) ?? [];
  const history =
    status?.recentRuns.filter(run => !['pending', 'running'].includes(run.status)) ?? [];
  const errorDescription = (code: string) =>
    t(`memory.runErrors.${code}`, { defaultValue: t('memory.runErrors.unknown') });

  function renderRun(run: MemoryRun) {
    const jobs = run.jobs.filter(job => job.stage === 'extract');
    return (
      <article
        key={run.runId}
        className="space-y-2 rounded border border-[var(--color-border)] p-3"
      >
        <p>
          {t(`memory.${run.status}`)}
          {run.result?.result &&
            ` · ${t(`memory.${run.result.result === 'empty' ? 'stateEmpty' : run.result.result}`)}`}{' '}
          · {new Date(run.createdAt).toLocaleString()}
        </p>
        {jobs.length > 0 && (
          <p className="text-sm text-[var(--color-text-muted)]">
            {t('memory.extractionProgress', {
              completed: jobs.filter(job => job.status === 'succeeded').length,
              failed: jobs.filter(job => job.status === 'failed').length,
              total: jobs.length,
            })}
          </p>
        )}
        {run.result?.error && (
          <div className="space-y-1">
            <p>{errorDescription(run.result.error.code)}</p>
            <details className="text-xs text-[var(--color-text-muted)]">
              <summary className="cursor-pointer">{t('memory.technicalDetails')}</summary>
              <p>
                {run.result.error.code}: {run.result.error.message}
              </p>
            </details>
          </div>
        )}
        {run.kind !== 'clear' && ['pending', 'running'].includes(run.status) && (
          <Button
            disabled={busy}
            onClick={() =>
              void action(() =>
                window.megumi.memory.cancelRun(
                  request(IPC_CHANNELS.memory.cancelRun, {
                    requestId: crypto.randomUUID(),
                    runId: run.runId,
                  }),
                ),
              )
            }
          >
            {t('memory.cancel')}
          </Button>
        )}
        {run.jobs.map(job => (
          <div key={job.jobId} className="text-sm">
            <p>
              {t(`memory.${job.stage}`)} · {t(`memory.${job.status}`)}
              {job.error ? ` · ${errorDescription(job.error.code)}` : ''}
            </p>
            {job.status === 'failed' && (
              <Button
                size="sm"
                disabled={busy || pending}
                onClick={() =>
                  void action(() =>
                    window.megumi.memory.startGeneration(
                      request(IPC_CHANNELS.memory.startGeneration, {
                        requestId: crypto.randomUUID(),
                        reason: 'retry',
                        failedJobId: job.jobId,
                      }),
                    ),
                  )
                }
              >
                {t('memory.retry')}
              </Button>
            )}
          </div>
        ))}
      </article>
    );
  }

  return (
    <section
      role="region"
      aria-label={t('memory.title')}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          navigate(onClose);
        }
      }}
      className="ui-page-enter flex h-full min-w-0 w-full flex-col bg-[var(--color-surface)] text-[var(--color-text)] [overflow-wrap:anywhere]"
    >
      <header className="flex min-h-16 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3 py-3">
        {(onBack || view !== 'content') && (
          <IconButton
            label={t(view === 'content' ? 'memory.back' : 'memory.backToMemory')}
            onClick={() => (view === 'content' ? onBack && navigate(onBack) : showView('content'))}
            size="sm"
            variant="ghost"
          >
            <ChevronLeft size={16} />
          </IconButton>
        )}
        <h2 className="min-w-0 flex-1 text-sm font-semibold">
          {t(
            view === 'content'
              ? 'memory.title'
              : view === 'sources'
                ? 'memory.manageSources'
                : 'memory.activity',
          )}
        </h2>
        <IconButton
          label={t('memory.refresh')}
          onClick={() => void load()}
          size="sm"
          variant="ghost"
        >
          <RefreshCw size={16} />
        </IconButton>
        <IconButton
          label={t('memory.close')}
          onClick={() => navigate(onClose)}
          size="sm"
          variant="ghost"
        >
          <PanelRightClose size={16} />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {pendingNavigation && (
          <div
            role="alertdialog"
            aria-label={t('memory.discard')}
            className="mb-4 space-y-3 rounded border border-[var(--color-border)] p-4"
          >
            <p>{t('memory.discardHelp')}</p>
            <Button onClick={() => setPendingNavigation(undefined)}>{t('memory.keepDraft')}</Button>
            <Button
              onClick={() => {
                setDraftOpen(false);
                pendingNavigation();
                setPendingNavigation(undefined);
              }}
            >
              {t('memory.discard')}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="mb-3 text-[var(--color-danger)]">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mb-3 text-sm">
            {notice}
          </p>
        )}
        {status && view !== 'sources' && (
          <p className="mb-4 text-sm text-[var(--color-text-muted)]">
            {t(
              (
                {
                  ready: 'memory.stateReady',
                  empty: 'memory.stateEmpty',
                  updating: 'memory.stateUpdating',
                  needsRepair: 'memory.stateNeedsRepair',
                  clearing: 'memory.stateClearing',
                } as const
              )[status.artifactState],
            )}
            {status.dirty ? ` · ${t('memory.dirty')}` : ''}
          </p>
        )}
        {view === 'activity' && status && (
          <div className="space-y-4">
            <p>
              {t('memory.generate')}:{' '}
              {t(status.generateMemories ? 'memory.enabled' : 'memory.disabled')} ·{' '}
              {t('memory.use')}: {t(status.useMemories ? 'memory.enabled' : 'memory.disabled')}
            </p>
            {(status.extractModel.status === 'unconfigured' ||
              status.consolidationModel.status === 'unconfigured') &&
              status.generateMemories && (
                <p className="text-sm text-[var(--color-text-muted)]">{t('memory.noModel')}</p>
              )}
            {(['extractModel', 'consolidationModel'] as const).map(field => {
              const capability = status[field];
              return (
                <p key={field}>
                  {t(`memory.${field}`)}:{' '}
                  {capability.status === 'unconfigured'
                    ? t('memory.unbound')
                    : capability.status === 'unavailable'
                      ? errorDescription('MODEL_UNAVAILABLE')
                      : `${capability.selection.providerId}/${capability.selection.modelId}`}
                </p>
              );
            })}
            <Button
              disabled={busy || pending || !status.generateMemories}
              onClick={() =>
                void action(() =>
                  window.megumi.memory.startGeneration(
                    request(IPC_CHANNELS.memory.startGeneration, {
                      requestId: crypto.randomUUID(),
                      reason: 'manual',
                    }),
                  ),
                )
              }
            >
              {t('memory.generateNow')}
            </Button>
            <section className="space-y-2 border-t border-[var(--color-border)] pt-3">
              <h3 className="text-sm font-medium">{t('memory.currentTask')}</h3>
              {running.length ? (
                running.map(renderRun)
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">
                  {t('memory.noRunningTask')}
                </p>
              )}
            </section>
            <details className="space-y-2 border-t border-[var(--color-border)] pt-3">
              <summary className="cursor-pointer text-sm font-medium">
                {t('memory.recentRuns')}
              </summary>
              {history.length ? (
                history.map(renderRun)
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">{t('memory.noRuns')}</p>
              )}
            </details>
            <div className="border-t border-[var(--color-border)] pt-3">
              <Button
                variant="danger"
                disabled={
                  busy ||
                  status.recentRuns.some(
                    run => run.kind === 'clear' && ['pending', 'running'].includes(run.status),
                  )
                }
                onClick={() => setClearOpen(true)}
              >
                {t('memory.clear')}
              </Button>
            </div>
            {clearOpen && (
              <div
                role="alertdialog"
                aria-label={t('memory.clear')}
                className="space-y-3 rounded border border-[var(--color-danger)] p-4"
              >
                <p>{t('memory.clearHelp')}</p>
                <Button onClick={() => setClearOpen(false)}>{t('memory.cancel')}</Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const result = await window.megumi.memory.clearMemory(
                        request(IPC_CHANNELS.memory.clearMemory, {
                          requestId: crypto.randomUUID(),
                          confirmed: true,
                        }),
                      );
                      if (result.ok) setClearOpen(false);

                      return result;
                    })
                  }
                >
                  {t('memory.confirmClear')}
                </Button>
              </div>
            )}
          </div>
        )}
        {view === 'sources' && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-text-muted)]">{t('memory.sourcesHelp')}</p>
            {sources.length === 0 && <p>{t('memory.empty')}</p>}
            {sources.map(item => (
              <article
                key={item.sessionId}
                className="space-y-2 rounded border border-[var(--color-border)] p-3"
              >
                <p>{item.title}</p>
                <p className="text-sm text-[var(--color-text-muted)]">
                  {item.contentUpdatedAt ? new Date(item.contentUpdatedAt).toLocaleString() : ''}
                </p>
                <p className="text-sm text-[var(--color-text-muted)]">
                  {t(
                    item.eligibility === 'excluded'
                      ? 'memory.sourceExcluded'
                      : item.selected
                        ? 'memory.selected'
                        : 'memory.notSelected',
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() =>
                      void action(async () => {
                        await useSessionStore.getState().loadSessions();

                        const session = useSessionStore
                          .getState()
                          .sessions.find(value => value.id === item.sessionId);
                        if (!session) throw new Error(t('memory.unavailable'));

                        useProjectStore.getState().setCurrentProject(session.projectId);
                        useSessionStore.getState().setActiveSession(item.sessionId);
                        onClose();

                        return {
                          ok: true,
                          data: {},
                        };
                      })
                    }
                  >
                    {t('memory.openSession')}
                  </Button>
                  {item.sourceRef && (
                    <Button
                      disabled={item.eligibility === 'excluded'}
                      onClick={() => {
                        if (item.sourceRef)
                          void openSource(item.sourceRef).catch(error => setError(String(error)));
                      }}
                    >
                      {t('memory.sourceEvidence')}
                    </Button>
                  )}
                  <Button
                    disabled={busy || pending}
                    onClick={() =>
                      void action(async () => {
                        const result = await window.megumi.memory.setSourceEligibility(
                          request(IPC_CHANNELS.memory.setSourceEligibility, {
                            requestId: crypto.randomUUID(),
                            sessionId: item.sessionId,
                            expectedVersion: item.version,
                            eligibility: item.eligibility === 'eligible' ? 'excluded' : 'eligible',
                          }),
                        );
                        if (result.ok && item.eligibility === 'eligible')
                          setNotice(
                            t(
                              result.data.maintenance === 'notRequired'
                                ? 'memory.excludedDone'
                                : 'memory.excluded',
                            ),
                          );

                        return result;
                      })
                    }
                  >
                    {t(item.eligibility === 'eligible' ? 'memory.exclude' : 'memory.restore')}
                  </Button>
                </div>
              </article>
            ))}
            {sourceCursor && (
              <Button onClick={() => void moreSources().catch(error => setError(String(error)))}>
                {t('memory.loadMore')}
              </Button>
            )}
          </div>
        )}
        {view === 'content' && (
          <div className="space-y-4">
            {selected && selected !== mainDocument?.path && (
              <Button
                size="sm"
                onClick={() =>
                  navigate(() => {
                    setDraftOpen(false);
                    setSelected('');
                    setDocumentTarget(undefined);
                  })
                }
              >
                {t('memory.backToMemory')}
              </Button>
            )}
            {selectedPath ? (
              <MemoryDocumentView
                key={selectedPath}
                path={selectedPath}
                versionHint={documents.find(item => item.path === selectedPath)?.version}
                onDraftChange={setDraftOpen}
                expectedVersion={
                  documentTarget?.path === selectedPath ? documentTarget.version : undefined
                }
                startLine={
                  documentTarget?.path === selectedPath ? documentTarget.startLine : undefined
                }
                blocked={pending ?? false}
                onReadSource={ref => void openSource(ref).catch(error => setError(String(error)))}
              />
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">{t('memory.emptyHelp')}</p>
            )}
            {relatedDocuments.length > 0 && (
              <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
                <p className="text-sm text-[var(--color-text-muted)]">
                  {t('memory.relatedContent')}
                </p>
                {relatedDocuments.map(item => (
                  <Button
                    key={item.path}
                    size="sm"
                    onClick={() =>
                      navigate(() => {
                        setDraftOpen(false);
                        setDocumentTarget(undefined);
                        setSelected(item.path);
                      })
                    }
                  >
                    {item.path.split('/')[1].replace(/[-_]/g, ' ')}
                  </Button>
                ))}
              </div>
            )}
            {documentCursor && (
              <Button onClick={() => void moreDocuments().catch(error => setError(String(error)))}>
                {t('memory.loadMore')}
              </Button>
            )}
          </div>
        )}
        {source && (
          <section className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">
            <Button onClick={() => setSource(undefined)}>{t('memory.close')}</Button>
            {source.page.status === 'found' ? (
              <>
                <h3 className="text-sm font-medium">{t('memory.sourceEvidence')}</h3>
                {source.page.sourceChanged && <p>{t('memory.sourceChanged')}</p>}
                {source.page.messages.map(message => (
                  <SourceMessage key={message.messageId} message={message} />
                ))}
                {source.page.nextCursor && (
                  <Button
                    onClick={() =>
                      void openSource(
                        source.ref,
                        source.page.status === 'found' ? source.page.nextCursor : undefined,
                      ).catch(error => setError(String(error)))
                    }
                  >
                    {t('memory.loadMore')}
                  </Button>
                )}
                <details className="text-xs text-[var(--color-text-muted)]">
                  <summary>{t('memory.technicalDetails')}</summary>
                  <p>
                    {source.page.workspaceId} · {source.page.sessionId} ·{' '}
                    {source.page.sourceVersion}
                  </p>
                </details>
              </>
            ) : (
              <p>{t('memory.unavailable')}</p>
            )}
          </section>
        )}
      </div>
      <footer className="shrink-0 space-y-2 border-t border-[var(--color-border)] p-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => showView('sources')}>
            {t('memory.manageSources')}
          </Button>
          <Button size="sm" onClick={() => showView('activity')}>
            {t('memory.activity')}
          </Button>
        </div>
        {onOpenSettings && (
          <Button className="w-full" onClick={() => navigate(onOpenSettings)}>
            {t('memory.openSettings')}
          </Button>
        )}
      </footer>
    </section>
  );
}

function SourceMessage({
  message,
}: {
  message: Extract<SourcePage, { status: 'found' }>['messages'][number];
}) {
  const { t } = useTranslation('settings');
  let text = '';
  if (!message.truncated) {
    try {
      text = sourceMessageText(message.text);
    } catch {
      return <p role="alert">{t('memory.sourceUnreadable')}</p>;
    }
  }

  return (
    <article className="space-y-2 rounded border border-[var(--color-border)] p-3 text-sm">
      <p className="font-medium">
        {t(
          message.kind === 'user_message'
            ? 'memory.sourceUser'
            : message.kind === 'assistant_reply'
              ? 'memory.sourceAssistant'
              : 'memory.sourceTool',
        )}
      </p>
      <p className="whitespace-pre-wrap">
        {message.truncated ? t('memory.sourceContinue') : text || t('memory.sourceNoText')}
      </p>
    </article>
  );
}

/** Reads bounded pages and assembles a full, version-consistent file only for explicit editing. */
function MemoryDocumentView({
  path,
  versionHint,
  expectedVersion,
  startLine,
  blocked,
  onReadSource,
  onDraftChange,
}: {
  onDraftChange: (dirty: boolean) => void;
  path: string;
  versionHint?: string;
  expectedVersion?: string;
  startLine?: number;
  blocked: boolean;
  onReadSource: (ref: string) => void;
}) {
  const { t } = useTranslation('settings');
  const [document, setDocument] = useState<MemoryDocumentSlice>();
  const [draft, setDraft] = useState<string>();
  const [draftVersion, setDraftVersion] = useState<string>();
  const [latest, setLatest] = useState<{
    content: string;
    version: string;
  }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onDraftChange(draft !== undefined);
  }, [draft, onDraftChange]);
  const readOnly = path === 'raw_memories.md' || path.startsWith('rollout_summaries/');
  const readPage = useCallback(
    async (line: number, version: string | undefined, character = 0, lineCount = 200) => {
      const result = await window.megumi.memory.readDocument(
        request(IPC_CHANNELS.memory.readDocument, {
          path,
          startLine: line,
          startCharacter: character,
          expectedVersion: version,
          lineCount,
        }),
      );
      if (!result.ok)
        throw new Error(
          result.data.code === 'VERSION_CONFLICT'
            ? t('memory.versionChanged')
            : result.data.message,
        );

      return result.data.status === 'found' ? result.data.document : undefined;
    },
    [path, t],
  );
  const load = useCallback(
    async (line = startLine ?? 1, version = expectedVersion, character = 0) => {
      setDocument(await readPage(line, version, character));
    },
    [readPage, expectedVersion, startLine],
  );
  useEffect(() => {
    void load().catch(error => setError(String(error)));
  }, [load, versionHint]);

  async function edit(refresh = false) {
    setBusy(true);
    setError('');

    try {
      let line = 1;
      let character = 0;
      let version: string | undefined;
      const chunks: string[] = [];
      for (;;) {
        const page = await readPage(line, version, character, 400);
        if (!page) throw new Error(t('memory.empty'));

        version = page.version;
        chunks.push(page.content);
        if (!page.truncated) break;

        line = page.nextLine;
        character = page.nextCharacter ?? 0;
      }

      const content = chunks.join('');
      if (refresh)
        setLatest({
          content,
          version,
        });
      else {
        setDraft(content);
        setDraftVersion(version);
      }
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (draft === undefined || !draftVersion) return;

    setBusy(true);
    setError('');

    try {
      const result = await window.megumi.memory.updateDocument(
        request(IPC_CHANNELS.memory.updateDocument, {
          requestId: crypto.randomUUID(),
          path,
          content: draft,
          expectedVersion: draftVersion,
        }),
      );
      if (!result.ok) {
        setError(
          result.data.code === 'VERSION_CONFLICT' ? t('memory.conflict') : result.data.message,
        );
        return;
      }

      setDraft(undefined);
      setLatest(undefined);
      await load(1, result.data.status === 'saved' ? result.data.document.version : undefined);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  const sourceRefs = [
    ...new Set(
      [...(document?.content.matchAll(/sourceRef=([^\]\s;]+)/g) ?? [])].map(match => match[1]),
    ),
  ];

  return (
    <section className="space-y-3">
      {error && (
        <p role="alert" className="text-[var(--color-danger)]">
          {error}
        </p>
      )}
      {draft === undefined ? (
        <>
          <div className="text-sm leading-6">
            <TimelineMarkdown
              text={document?.content ? memoryReadingText(document.content) : t('memory.empty')}
            />
          </div>
          {document?.truncated && (
            <Button
              onClick={() =>
                void load(document.nextLine, document.version, document.nextCharacter).catch(
                  error => setError(String(error)),
                )
              }
            >
              {t('memory.moreLines')}
            </Button>
          )}
          {document && !readOnly && (
            <Button disabled={busy || blocked} onClick={() => void edit()}>
              {t('memory.edit')}
            </Button>
          )}
        </>
      ) : (
        <>
          <textarea
            aria-label={t('memory.draft')}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            rows={20}
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || blocked} onClick={() => void save()}>
              {t('memory.save')}
            </Button>
            <Button disabled={busy} onClick={() => void edit(true)}>
              {t('memory.reload')}
            </Button>
            <Button
              onClick={() => {
                setDraft(undefined);
                setLatest(undefined);
              }}
            >
              {t('memory.discard')}
            </Button>
          </div>
          {latest && (
            <div>
              <h4>{t('memory.latest')}</h4>
              <pre className="whitespace-pre-wrap text-xs">{latest.content}</pre>
              <Button
                onClick={() => {
                  setDraftVersion(latest.version);
                  setLatest(undefined);
                }}
              >
                {t('memory.mergeDraft')}
              </Button>
              <Button
                onClick={() => {
                  setDraft(latest.content);
                  setDraftVersion(latest.version);
                  setLatest(undefined);
                }}
              >
                {t('memory.applyLatest')}
              </Button>
            </div>
          )}
        </>
      )}
      {sourceRefs.map(ref => (
        <Button key={ref} size="sm" onClick={() => onReadSource(ref)}>
          {t('memory.sourceEvidence')}
        </Button>
      ))}
    </section>
  );
}
