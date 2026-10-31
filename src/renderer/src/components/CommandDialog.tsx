import { useState } from 'react';
import { Copy, Loader2, Sparkles, TerminalSquare } from 'lucide-react';
import type { CommandAnalysis } from '@shared/types';
import { Modal } from './Modal';
import { Markdown } from './Markdown';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { riskColor, riskLabel } from '../lib/format';

/** 命令分析：本地规则 + AI 解释，只分析不执行。 */
export function CommandDialog({
  serverId,
  onClose,
  onInsert,
}: {
  serverId: string;
  onClose: () => void;
  onInsert: (command: string) => void;
}) {
  const notify = useApp((state) => state.notify);
  const [command, setCommand] = useState('');
  const [result, setResult] = useState<CommandAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  const analyze = async () => {
    const text = command.trim();
    if (!text) return;
    setLoading(true);
    setResult(null);
    try {
      const analysis = await api.ai.analyzeCommand(serverId, text);
      setResult(analysis);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(command);
    notify('success', '命令已复制');
  };

  const risk = result ? riskColor(result.risk) : null;

  return (
    <Modal
      title="命令分析"
      description="先看清命令做什么、有什么风险，再决定是否执行。这里不会执行任何命令。"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <button className="btn" onClick={() => void copy()} disabled={!command.trim()}>
            <Copy size={13} />
            复制
          </button>
          <button
            className="btn"
            onClick={() => onInsert(command)}
            disabled={!command.trim() || !result}
            title="把命令插入终端，但不会回车执行"
          >
            <TerminalSquare size={13} />
            插入终端
          </button>
          <button className="btn btn-primary" onClick={() => void analyze()} disabled={loading || !command.trim()}>
            {loading ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            {loading ? '分析中…' : '开始分析'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">待分析命令</label>
          <textarea
            className="input mono min-h-[110px] text-[12.5px] leading-relaxed"
            placeholder="例如：systemctl restart nginx"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            spellCheck={false}
          />
        </div>

        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] text-[var(--muted)]">本地风险判定</span>
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11.5px] font-medium',
                  risk!.text,
                  risk!.bg,
                  risk!.border,
                )}
              >
                {riskLabel(result.risk)}
              </span>
              <span className="truncate text-[11.5px] text-[var(--muted-2)]">
                {result.reasons.join('；')}
              </span>
            </div>

            {result.explanation ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-[var(--muted)]">
                  <Sparkles size={11} className="text-[var(--accent)]" />
                  AI 分析
                </div>
                <Markdown content={result.explanation} />
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-[12px] text-[var(--muted-2)]">
                {result.error ? `AI 分析失败：${result.error}` : '未配置模型或分析未返回内容。'}
              </div>
            )}
          </div>
        )}

        {!result && !loading && (
          <p className="text-[11.5px] leading-relaxed text-[var(--muted-2)]">
            分析会结合本地危险命令规则和当前服务器上下文。即使风险为“只读”，也请确认命令内容后再执行。
          </p>
        )}
      </div>
    </Modal>
  );
}
