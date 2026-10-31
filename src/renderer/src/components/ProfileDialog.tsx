import { useEffect, useState } from 'react';
import { Database, Download, Loader2, Sparkles } from 'lucide-react';
import { Modal } from './Modal';
import { Markdown } from './Markdown';
import { api } from '../lib/api';
import { useApp } from '../store/app';

/** 展示完整服务器档案（Markdown），并允许直接维护运维笔记。 */
export function ProfileDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
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
      title="服务器档案"
      description={
        profile
          ? `${profile.hostname} · ${profile.role} · 扫描于 ${new Date(profile.scannedAt).toLocaleString('zh-CN', { hour12: false })}`
          : '尚未生成档案'
      }
      onClose={onClose}
      width="max-w-5xl"
      footer={
        <>
          <button
            className="mr-auto btn h-8"
            onClick={() => void exportProfile(serverId)}
            title="导出为本地 Markdown 文件"
          >
            <Download size={13} />
            导出
          </button>
          <button className="btn h-8" onClick={() => void summarize(serverId)}>
            <Sparkles size={13} />
            AI 重新总结
          </button>
          <button className="btn btn-primary h-8" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存笔记'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {markdown === null ? (
            <div className="flex items-center gap-2 py-10 text-[12.5px] text-[var(--muted)]">
              <Loader2 size={14} className="spin" />
              加载档案…
            </div>
          ) : markdown ? (
            <Markdown content={markdown} />
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-[12.5px] text-[var(--muted-2)]">
              <Database size={20} />
              还没有生成档案，请先连接服务器并执行侦察。
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="panel-2 sticky top-0 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-[var(--text)]">运维笔记</span>
              <span className="text-[11px] text-[var(--muted-2)]">Markdown</span>
            </div>
            <textarea
              className="input min-h-[320px] text-[12.5px] leading-relaxed"
              placeholder="记录这台服务器的部署结构、关键配置、历史问题…"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--muted-2)]">
              笔记会保存在本地，并在每次 AI 对话时注入上下文；勾选「同步档案到服务器」后也会写入远端。
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
