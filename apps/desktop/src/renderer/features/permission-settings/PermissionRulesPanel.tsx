/* Manages explicit allow, ask, and deny rules without duplicating Composer Permission Mode. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { PERMISSION_RULE_CATALOG, PermissionRuleSchema, type PermissionRule } from '@megumi/agent-runtime/permissions';
import type { SettingsSnapshot } from '@megumi/application/settings/settings-contracts';
import { useProjectStore } from '../../entities/project';
import { useSessionStore } from '../../entities/session';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';
import { Button, SettingsSection, cx } from '../../shared/ui';

type PermissionRuleEffectUi = 'allow' | 'ask' | 'deny';
type PermissionRuleUiDto = PermissionRule & { effect: PermissionRuleEffectUi };
type ToolOption = { sourceId: string; namespace: string; sourceToolName: string; registeredToolName: string; displayName: string };
type PermissionSettings = { rules: PermissionRuleUiDto[]; catalog: { operations: Array<{ action: string; resourceType?: string; operators: Array<'any' | 'exact' | 'prefix' | 'glob' | 'hostname'> }>; tools: ToolOption[] } };
function permissionView(snapshot: SettingsSnapshot, tools: ToolOption[]): PermissionSettings {
  return { rules: EFFECTS.flatMap((effect) => snapshot.config.permissions[effect].map((rule) => ({ ...rule, effect }))), catalog: { operations: PERMISSION_RULE_CATALOG.map((item) => ({ action: item.action, resourceType: 'resource_type' in item ? item.resource_type : undefined, operators: [...item.operators] })), tools } };
}
type RuleTargetKind = PermissionRuleUiDto['target']['kind'];
type RuleScope = 'user' | 'workspace';

const fieldClassName = 'h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none transition focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20';
const EFFECTS: PermissionRuleEffectUi[] = ['allow', 'ask', 'deny'];

export function PermissionRulesPanel() {
  const { t } = useTranslation('settings');
  const workspaceId = useProjectStore((state) => state.currentProjectId);
  const projects = useProjectStore((state) => state.projects);
  const sessions = useSessionStore((state) => state.sessions);
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>();
  const [permissions, setPermissions] = useState<PermissionSettings>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'failed'>('loading');
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [effect, setEffect] = useState<PermissionRuleEffectUi>('allow');
  const [targetKind, setTargetKind] = useState<RuleTargetKind>('operation');
  const [action, setAction] = useState('network.fetch');
  const [operator, setOperator] = useState<'any' | 'exact' | 'prefix' | 'glob' | 'hostname'>('hostname');
  const [value, setValue] = useState('');
  const [scope, setScope] = useState<RuleScope>('user');
  const [toolName, setToolName] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.all([window.megumi.settings.readSettings(), window.megumi.tools.list()]).then(([result, tools]) => {
      if (!active) return;
      if (!result.ok || !tools.ok) {
        setError(!result.ok ? result.data.message : !tools.ok ? tools.data.message : '');
        setStatus('failed');
        return;
      }
      const view = permissionView(result.data, tools.data.tools.map((tool) => ({ ...tool.identity, registeredToolName: tool.name, displayName: tool.displayName })));
      setSnapshot(result.data);
      setPermissions(view);
      selectAction('network.fetch', view);
      setToolName(view.catalog.tools[0]?.registeredToolName ?? '');
      setStatus('ready');
    });
    return () => { active = false; };
  }, [t]);

  const operation = useMemo(
    () => permissions?.catalog.operations.find((item) => item.action === action),
    [action, permissions],
  );
  const requiresValue = operator !== 'any' && Boolean(operation?.resourceType);

  function selectAction(nextAction: string, source = permissions) {
    setAction(nextAction);
    const nextOperation = source?.catalog.operations.find((item) => item.action === nextAction);
    const preferred = nextOperation?.operators.includes('hostname') ? 'hostname' : nextOperation?.operators[0] ?? 'any';
    setOperator(preferred);
    setValue('');
  }

  async function mutate(operationType: 'add' | 'remove', rule: PermissionRuleUiDto) {
    if (!snapshot || !permissions) return;
    setStatus('saving');
    setError(undefined);
    const { effect: group, ...value } = rule;
    const current = snapshot.config.permissions[group];
    const rules = operationType === 'add' ? [...current, value]
      : current.filter((item) => JSON.stringify(item) !== JSON.stringify(value));
    const result = await window.megumi.settings.updateSettings({ patch: { permissions: { [group]: rules } }, expectedRevision: snapshot.revision });
    if (!result.ok) { setError(result.data.message); setStatus('failed'); return; }
    setSnapshot(result.data.settings);
    setPermissions(permissionView(result.data.settings, permissions.catalog.tools));
    setStatus('ready');
    setEditing(false);
  }

  async function saveRule() {
    if (!permissions || (scope === 'workspace' && !workspaceId)) return;
    const source = scope === 'workspace' ? { source: 'workspace', source_id: workspaceId } : { source: 'user' };
    const tool = permissions.catalog.tools.find((item) => item.registeredToolName === toolName);
    if (targetKind === 'tool' && !tool) return;
    const target = targetKind === 'tool' && tool ? { kind: 'tool', tool_identity: { source_id: tool.sourceId, namespace: tool.namespace, source_tool_name: tool.sourceToolName } }
      : { kind: 'operation', action, ...(operation?.resourceType ? { resource: { type: operation.resourceType, matcher: operator === 'any' ? { operator } : { operator, value: value.trim() } } } : {}) };
    const parsed = PermissionRuleSchema.safeParse({ ...source, target });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    await mutate('add', { effect, ...parsed.data });
  }

  const canSave = status !== 'saving'
    && (scope !== 'workspace' || Boolean(workspaceId))
    && (targetKind === 'tool' ? Boolean(toolName) : Boolean(operation) && (!requiresValue || Boolean(value.trim())));

  return (
    <SettingsSection title={t('security.rules.title')} description={t('security.rules.description')}>
      <div className="space-y-5 p-5">
        <div className="flex items-center justify-between gap-4">
          <p className="max-w-2xl text-sm leading-6 text-[var(--color-text-muted)]">{t('security.rules.precedence')}</p>
          <Button size="sm" onClick={() => setEditing((current) => !current)}>
            <Plus size={14} aria-hidden="true" />{t('security.rules.add')}
          </Button>
        </div>

        {editing ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)]/55 p-4 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label={t('security.rules.effect')}>
                <select className={fieldClassName} aria-label={t('security.rules.effect')} value={effect} onChange={(event) => setEffect(event.target.value as PermissionRuleEffectUi)}>
                  {EFFECTS.map((item) => <option key={item} value={item}>{t(`security.rules.effects.${item}`)}</option>)}
                </select>
              </Field>
              <Field label={t('security.rules.target')}>
                <select className={fieldClassName} aria-label={t('security.rules.target')} value={targetKind} onChange={(event) => setTargetKind(event.target.value as RuleTargetKind)}>
                  <option value="operation">{t('security.rules.operationTarget')}</option>
                  <option value="tool">{t('security.rules.toolTarget')}</option>
                </select>
              </Field>
              <Field label={t('security.rules.scope')}>
                <select className={fieldClassName} aria-label={t('security.rules.scope')} value={scope} onChange={(event) => setScope(event.target.value as RuleScope)}>
                  <option value="user">{t('security.rules.scopes.user')}</option>
                  <option value="workspace" disabled={!workspaceId}>{t('security.rules.scopes.workspace')}</option>
                </select>
              </Field>
              {targetKind === 'operation' ? (
                <>
                  <Field label={t('security.rules.operation')}>
                    <select className={fieldClassName} aria-label={t('security.rules.operation')} value={action} onChange={(event) => selectAction(event.target.value)}>
                      {permissions?.catalog.operations.map((item) => <option key={item.action} value={item.action}>{actionLabel(item.action, t)}</option>)}
                    </select>
                  </Field>
                  {operation?.resourceType ? (
                    <Field label={t('security.rules.matchType')}>
                      <select className={fieldClassName} aria-label={t('security.rules.matchType')} value={operator} onChange={(event) => setOperator(event.target.value as typeof operator)}>
                        {operation.operators.map((item) => <option key={item} value={item}>{t(`security.rules.operators.${item}`)}</option>)}
                      </select>
                    </Field>
                  ) : null}
                  {requiresValue ? (
                    <Field label={t('security.rules.matchValue')}>
                      <input className={fieldClassName} aria-label={t('security.rules.matchValue')} value={value} onChange={(event) => setValue(event.target.value)} placeholder={valuePlaceholder(operator, t)} />
                    </Field>
                  ) : null}
                </>
              ) : (
                <Field label={t('security.rules.tool')}>
                  <select className={fieldClassName} aria-label={t('security.rules.tool')} value={toolName} onChange={(event) => setToolName(event.target.value)}>
                    {permissions?.catalog.tools.map((tool) => <option key={`${tool.sourceId}:${tool.registeredToolName}`} value={tool.registeredToolName}>{tool.displayName}</option>)}
                  </select>
                </Field>
              )}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t('security.rules.cancel')}</Button>
              <Button size="sm" variant="primary" disabled={!canSave} onClick={() => { void saveRule(); }}>{status === 'saving' ? t('security.rules.saving') : t('security.rules.save')}</Button>
            </div>
          </div>
        ) : null}

        {error ? <div role="alert" className="flex items-start gap-2 rounded-lg border border-[var(--color-danger)]/35 bg-[var(--color-danger)]/8 px-3 py-2 text-sm text-[var(--color-danger)]"><ShieldAlert size={16} className="mt-0.5 shrink-0" />{error}</div> : null}
        {status === 'loading' ? <p className="text-sm text-[var(--color-text-muted)]">{t('security.rules.loading')}</p> : null}

        <div className="grid gap-4 xl:grid-cols-3">
          {EFFECTS.map((group) => {
            const rules = permissions?.rules.filter((rule) => rule.effect === group) ?? [];
            return (
              <section key={group} aria-label={t(`security.rules.effects.${group}`)} className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">{t(`security.rules.effects.${group}`)}</h3>
                  <span className={cx('rounded-full px-2 py-0.5 text-[0.68rem] font-semibold tabular-nums', effectTone(group))}>{rules.length}</span>
                </div>
                <div className="divide-y divide-[var(--color-border)]">
                  {rules.length === 0 ? <p className="px-4 py-5 text-xs text-[var(--color-text-subtle)]">{t('security.rules.empty')}</p> : rules.map((rule, index) => (
                    <div key={`${group}:${index}:${ruleLabel(rule, permissions)}`} className="group flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-medium text-[var(--color-text)]">{ruleLabel(rule, permissions)}</p>
                        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{sourceLabel(rule, t, projects, sessions)}</p>
                      </div>
                      <button type="button" disabled={status === 'saving'} aria-label={t('security.rules.deleteNamed', { name: ruleLabel(rule, permissions) })} onClick={() => { void mutate('remove', rule); }} className="rounded-md p-1.5 text-[var(--color-text-subtle)] opacity-70 transition hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] group-hover:opacity-100">
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </SettingsSection>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="space-y-1.5"><span className="text-xs font-medium text-[var(--color-text-muted)]">{label}</span>{children}</label>;
}

function effectTone(effect: PermissionRuleEffectUi) {
  if (effect === 'allow') return 'bg-[var(--color-success)]/12 text-[var(--color-success)]';
  if (effect === 'deny') return 'bg-[var(--color-danger)]/12 text-[var(--color-danger)]';
  return 'bg-[var(--color-warning)]/14 text-[var(--color-warning)]';
}

function actionLabel(action: string, t: TFunction<'settings'>) {
  if (action === 'workspace.read') return t('security.rules.actions.workspace_read');
  if (action === 'workspace.write') return t('security.rules.actions.workspace_write');
  if (action === 'process.execute') return t('security.rules.actions.process_execute');
  if (action === 'network.search') return t('security.rules.actions.network_search');
  if (action === 'network.fetch') return t('security.rules.actions.network_fetch');
  if (action === 'agent.context.activate') return t('security.rules.actions.agent_context_activate');
  if (action === 'external.invoke') return t('security.rules.actions.external_invoke');
  return action;
}

function ruleLabel(rule: PermissionRuleUiDto, permissions?: PermissionSettings): string {
  if (rule.target.kind === 'tool') {
    const target = rule.target.tool_identity;
    return permissions?.catalog.tools.find((tool) => tool.sourceId === target.source_id && tool.namespace === target.namespace && tool.sourceToolName === target.source_tool_name)?.displayName ?? target.source_tool_name;
  }
  const matcher = rule.target.resource?.matcher;
  return matcher && 'value' in matcher ? matcher.value : rule.target.action;
}

function sourceLabel(
  rule: PermissionRuleUiDto,
  t: TFunction<'settings'>,
  projects: Array<{ id: string; name: string }>,
  sessions: Array<{ id: string; title: string }>,
) {
  if (rule.source === 'user') return t('security.rules.sources.user');
  if (rule.source === 'workspace') {
    const name = projects.find((project) => project.id === rule.source_id)?.name;
    return name ? `${t('security.rules.sources.workspace')} · ${name}` : t('security.rules.sources.workspace');
  }
  const title = sessions.find((session) => session.id === rule.source_id)?.title;
  return title ? `${t('security.rules.sources.session')} · ${title}` : t('security.rules.sources.session');
}

function valuePlaceholder(operator: string, t: TFunction<'settings'>) {
  return operator === 'hostname' ? t('security.rules.hostnamePlaceholder') : t('security.rules.valuePlaceholder');
}
