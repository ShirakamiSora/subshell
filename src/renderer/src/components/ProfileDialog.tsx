import { useEffect, useState } from 'react';
import { Database, Download, Loader2, Sparkles } from 'lucide-react';
import { Modal } from './Modal';
import { Markdown } from './Markdown';
import { api } from '../lib/api';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';

/** 展示完整服务器档案（Markdown），并允许直接维护运维笔记。 */
export function ProfileDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const { t, language } = useI18n();
  const profile = useApp((state) => state.profiles[serverId]);
  const saveNotes = useApp((state) => state.saveProfileNotes);
  const summarize = useApp((state) => state.summarize);
  const exportProfile = useApp((state) => state.exportProfile);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [notes, setNotes] = useState(profile?.notes ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.profile.markdown(serverId).then((text) => {
      if (!cancelled) setMarkdown(text);
    });
    return () => {
      cancelled = true;
    };
  }, [serverId, profile?.lastUpdated]);

  const save = async () => {
    setSaving(true);
    await saveNotes(serverId, notes);
    setSaving(false);
  };

  return (
    <Modal
      title={t('profile.title')}
      description={
        profile
          ? t('profile.subtitle', {
              host: profile.hostname,
              role: profile.role,
              time: new Date(profile.scannedAt).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN', {
                hour12: false,
              }),
            })
          : t('profile.noProfile')
      }
      onClose={onClose}
      width="max-w-5xl"
      footer={
        <>
          <button
            className="mr-auto btn h-8"
            onClick={() => void exportProfile(serverId)}
            title={t('profile.exportTitle')}
          >
            <Download size={13} />
            {t('profile.export')}
          </button>
          <button className="btn h-8" onClick={() => void summarize(serverId)}>
            <Sparkles size={13} />
            {t('profile.summarize')}
          </button>
          <button className="btn btn-primary h-8" onClick={() => void save()} disabled={saving}>
            {saving ? t('profile.saving') : t('profile.saveNotes')}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {markdown === null ? (
            <div className="flex items-center gap-2 py-10 text-[12.5px] text-[var(--muted)]">
              <Loader2 size={14} className="spin" />
              {t('profile.loading')}
            </div>
          ) : markdown ? (
            <Markdown content={markdown} />
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-[12.5px] text-[var(--muted-2)]">
              <Database size={20} />
              {t('profile.empty')}
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="panel-2 sticky top-0 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-[var(--text)]">{t('profile.notes.title')}</span>
              <span className="text-[11px] text-[var(--muted-2)]">Markdown</span>
            </div>
            <textarea
              className="input min-h-[320px] text-[12.5px] leading-relaxed"
              placeholder={t('profile.notes.placeholder')}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--muted-2)]">{t('profile.notes.hint')}</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
