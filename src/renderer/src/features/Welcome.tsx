import { Radar, ServerCog, Sparkles, TerminalSquare, Plus } from 'lucide-react';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';

const features = [
  { icon: Radar, titleKey: 'welcome.feature.discover.title', descKey: 'welcome.feature.discover.desc' },
  { icon: TerminalSquare, titleKey: 'welcome.feature.nlp.title', descKey: 'welcome.feature.nlp.desc' },
  { icon: ServerCog, titleKey: 'welcome.feature.monitor.title', descKey: 'welcome.feature.monitor.desc' },
];

export function Welcome() {
  const setDialog = useApp((state) => state.setDialog);
  const servers = useApp((state) => state.servers);
  const { t } = useI18n();

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-[var(--bg)] px-8">
      <div className="relative w-full max-w-2xl">
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1 text-[12px] text-[var(--muted)]">
          <Sparkles size={12} className="text-[var(--accent)]" />
          {t('welcome.badge')}
        </div>
        <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-[var(--text)]">
          {t('welcome.title.line1')}
          <br />
          {t('welcome.title.line2')}
        </h1>
        <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-[var(--muted)]">{t('welcome.desc')}</p>

        <div className="mt-7 grid grid-cols-3 gap-3">
          {features.map((feature) => (
            <div key={feature.titleKey} className="panel-2 p-3.5">
              <feature.icon size={16} className="text-[var(--accent)]" />
              <div className="mt-2 text-[13px] font-semibold text-[var(--text)]">{t(feature.titleKey)}</div>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted-2)]">{t(feature.descKey)}</p>
            </div>
          ))}
        </div>

        <div className="mt-7 flex items-center gap-2.5">
          <button className="btn btn-primary h-9 px-4" onClick={() => setDialog('server')}>
            <Plus size={15} />
            {t('welcome.addServer')}
          </button>
        </div>
        <p className="mt-3 text-[12px] text-[var(--muted-2)]">
          {servers.length > 0 ? t('welcome.hint.hasServers') : t('welcome.hint.empty')}
        </p>
      </div>
    </div>
  );
}
