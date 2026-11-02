import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Plus, RotateCcw, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import type { ApprovalAction, ApprovalRecord, ApprovalRule, ApprovalVerdict } from '@shared/types';
import { Modal, ConfirmDialog } from './Modal';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { formatRelative } from '../lib/format';

const actionStyle: Record<ApprovalAction, { text: string; bg: string; border: string }> = {
  approve: { text: 'text-[var(--success)]', bg: 'bg-emerald-400/10', border: 'border-emerald-400/25' },
  ask: { text: 'text-[var(--warning)]', bg: 'bg-amber-400/10', border: 'border-amber-400/25' },
  reject: { text: 'text-[var(--danger)]', bg: 'bg-rose-400/10', border: 'border-rose-400/25' },
};

/** 智能审批命令库：内置规则 + 用户自定义规则 + 审批记录 + 规则测试。 */
export function ApprovalRulesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const activeServerId = useApp((state) => state.activeServerId);
  const servers = useApp((state) => state.servers);
  const notify = useApp((state) => state.notify);
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [records, setRecords] = useState<ApprovalRecord[]>([]);
  const [editing, setEditing] = useState<ApprovalRule | 'new' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [testCommand, setTestCommand] = useState('systemctl restart nginx');
  const [testing, setTesting] = useState(false);
  const [verdict, setVerdict] = useState<ApprovalVerdict | null>(null);

  const serverId = activeServerId ?? servers[0]?.id ?? '';

  useEffect(() => {
    void api.approval.rules().then(setRules).catch(() => undefined);
    void api.approval.records(undefined, 50).then(setRecords).catch(() => undefined);
  }, []);

  const toggle = async (rule: ApprovalRule, enabled: boolean) => {
    try {
      setRules(await api.approval.toggleRule(rule.id, enabled));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (id: string) => {
    try {
      setRules(await api.approval.deleteRule(id));
      setDeleting(null);
      notify('success', t('approval.ruleDeleted'));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error));
    }
  };

  const test = async () => {
    if (!testCommand.trim()) return;
    setTesting(true);
    try {
      setVerdict(await api.approval.test(serverId, testCommand.trim()));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <Modal
        title={t('approval.rulesTitle')}
        description={t('approval.rulesDesc')}
        onClose={onClose}
        width="max-w-4xl"
        footer={
          <>
            <button className="btn mr-auto h-8 px-2.5 text-[12px]" onClick={() => setConfirmReset(true)}>
              <RotateCcw size={12} />
              {t('approval.resetRules')}
            </button>
            <button className="btn btn-primary h-8 px-3 text-[12.5px]" onClick={() => setEditing('new')}>
              <Plus size={12} />
              {t('approval.addRule')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <section>
            <div className="mb-1.5 flex items-center gap-2">
              <ShieldCheck size={13} className="text-[var(--accent)]" />
              <span className="text-[12.5px] font-semibold text-[var(--text)]">{t('approval.rules')}</span>
              <span className="text-[11px] text-[var(--muted-2)]">{t('approval.rulesHint')}</span>
            </div>
            <div className="space-y-1.5">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className={cn(
                    'rounded-lg border px-3 py-2',
                    rule.enabled ? 'border-[var(--border)] bg-[var(--panel-2)]' : 'border-[var(--border)] bg-[var(--panel-2)] opacity-60',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-medium text-[var(--text)]">{rule.name}</span>
                    <span
                      className={cn(
                        'rounded-full border px-1.5 py-px text-[10px]',
                        actionStyle[rule.action].text,
                        actionStyle[rule.action].bg,
                        actionStyle[rule.action].border,
                      )}
                    >
                      {t(`approval.action.${rule.action}`)}
                    </span>
                    {rule.builtin && (
                      <span className="rounded bg-sky-400/10 px-1.5 py-px text-[10px] text-[var(--blue)]">
                        {t('approval.builtin')}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1">
                      <button
                        className="btn btn-ghost h-6 px-2 text-[11px]"
                        onClick={() => setEditing(rule)}
                      >
                        {t('approval.editRule')}
                      </button>
                      <button
                        className="btn btn-ghost h-6 px-2 text-[11px] text-rose-300/80 hover:text-[var(--danger)]"
                        onClick={() => setDeleting(rule.id)}
                      >
                        <Trash2 size={11} />
                      </button>
                      <button
                        role="switch"
                        aria-checked={rule.enabled}
                        onClick={() => void toggle(rule, !rule.enabled)}
                        className={cn(
                          'relative h-4 w-8 rounded-full transition-colors',
                          rule.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--panel-3)] ring-1 ring-inset ring-[var(--border-strong)]',
                        )}
                      >
                        <span
                          className={cn(
                            'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all',
                            rule.enabled ? 'left-[18px]' : 'left-0.5',
                          )}
                        />
                      </button>
                    </span>
                  </div>
                  <div className="mono mt-1 truncate text-[11px] text-[var(--muted)]">{rule.pattern}</div>
                  {rule.note && <p className="mt-0.5 text-[11px] text-[var(--muted-2)]">{rule.note}</p>}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
            <div className="text-[12px] font-medium text-[var(--text)]">{t('approval.testTitle')}</div>
            <p className="mt-0.5 text-[11px] text-[var(--muted-2)]">{t('approval.testDesc')}</p>
            <div className="mt-1.5 flex gap-1.5">
              <input
                className="input mono h-8 flex-1 text-[12px]"
                value={testCommand}
                onChange={(event) => {
                  setTestCommand(event.target.value);
                  setVerdict(null);
                }}
                placeholder="systemctl restart nginx"
              />
              <button className="btn h-8 px-3 text-[12px]" onClick={() => void test()} disabled={testing}>
                {testing ? <Loader2 size={12} className="spin" /> : <ShieldCheck size={12} />}
                {t('approval.test')}
              </button>
            </div>
            {verdict && (
              <div className="mt-2 rounded border border-[var(--border)] bg-[var(--panel)] px-2.5 py-2 text-[11.5px]">
                <div className="flex items-center gap-2">
                  {verdict.decision === 'reject' ? (
                    <XCircle size={12} className="text-[var(--danger)]" />
                  ) : verdict.decision === 'approve' ? (
                    <CheckCircle2 size={12} className="text-[var(--success)]" />
                  ) : (
                    <ShieldCheck size={12} className="text-[var(--warning)]" />
                  )}
                  <span className="font-medium text-[var(--text)]">
                    {t(`approval.action.${verdict.decision}`)}
                  </span>
                  <span className="text-[10.5px] text-[var(--muted-2)]">
                    {t(`approval.source.${verdict.source}`)}
                    {verdict.ruleName ? ` · ${verdict.ruleName}` : ''}
                  </span>
                </div>
                <p className="mt-1 text-[var(--muted)]">{verdict.reason}</p>
              </div>
            )}
          </section>

          <section>
            <div className="mb-1.5 text-[12.5px] font-semibold text-[var(--text)]">{t('approval.records')}</div>
            {records.length === 0 ? (
              <p className="text-[11.5px] text-[var(--muted-2)]">{t('approval.noRecords')}</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                {records.slice(0, 20).map((record) => (
                  <div key={record.id} className="flex items-center gap-2 border-b border-[var(--border)]/60 px-2.5 py-1.5 last:border-0">
                    <span className={cn('text-[10.5px]', actionStyle[record.decision].text)}>
                      {t(`approval.action.${record.decision}`)}
                    </span>
                    <span className="mono min-w-0 flex-1 truncate text-[11px] text-[var(--muted)]">
                      {record.command}
                    </span>
                    <span className="text-[10px] text-[var(--muted-2)]">{t(`approval.source.${record.source}`)}</span>
                    <span className="text-[10px] text-[var(--muted-2)]">{formatRelative(record.ts)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </Modal>

      {editing && (
        <RuleForm
          rule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setRules(next);
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('approval.deleteRule')}
          message={t('approval.deleteRuleMessage')}
          confirmText={t('common.delete')}
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      )}

      {confirmReset && (
        <ConfirmDialog
          title={t('approval.resetRules')}
          message={t('approval.resetMessage')}
          confirmText={t('common.confirm')}
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            void api.approval
              .resetRules()
              .then(setRules)
              .catch((error) => notify('error', error instanceof Error ? error.message : String(error)));
          }}
        />
      )}
    </>
  );
}

function RuleForm({
  rule,
  onClose,
  onSaved,
}: {
  rule: ApprovalRule | null;
  onClose: () => void;
  onSaved: (rules: ApprovalRule[]) => void;
}) {
  const { t } = useI18n();
  const notify = useApp((state) => state.notify);
  const [name, setName] = useState(rule?.name ?? '');
  const [pattern, setPattern] = useState(rule?.pattern ?? '');
  const [action, setAction] = useState<ApprovalAction>(rule?.action ?? 'ask');
  const [note, setNote] = useState(rule?.note ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim() || !pattern.trim()) {
      notify('warning', t('approval.needFields'));
      return;
    }
    setSaving(true);
    try {
      const next = await api.approval.saveRule({
        id: rule?.id,
        name: name.trim(),
        pattern: pattern.trim(),
        action,
        note: note.trim() || undefined,
        enabled: rule?.enabled ?? true,
      });
      notify('success', t('approval.ruleSaved'));
      onSaved(next);
    } catch (error) {
      notify('error', t('approval.invalidPattern', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={rule ? t('approval.editRule') : t('approval.addRule')}
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 size={12} className="spin" /> : null}
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">{t('approval.ruleName')}</label>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div>
          <label className="label">{t('approval.rulePattern')}</label>
          <input
            className="input mono text-[12.5px]"
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            placeholder="^\\s*systemctl\\s+restart\\s+nginx$"
          />
          <p className="mt-1 text-[11px] text-[var(--muted-2)]">{t('approval.rulePatternHint')}</p>
        </div>
        <div>
          <label className="label">{t('approval.ruleAction')}</label>
          <select
            className="input h-8"
            value={action}
            onChange={(event) => setAction(event.target.value as ApprovalAction)}
          >
            <option value="approve">{t('approval.action.approve')}</option>
            <option value="ask">{t('approval.action.ask')}</option>
            <option value="reject">{t('approval.action.reject')}</option>
          </select>
        </div>
        <div>
          <label className="label">{t('approval.ruleNote')}</label>
          <input className="input" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
