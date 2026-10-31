import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Coins,
  Eraser,
  Loader2,
  MessageSquare,
  Settings2,
  Sparkles,
  Square,
  TerminalSquare,
  Wrench,
} from 'lucide-react';
import { UsageDialog } from '../components/UsageDialog';
import type { AgentRunState, ChatMessage } from '@shared/types';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { Markdown } from '../components/Markdown';
import { ToolCallCard } from './ToolCallCard';
import { cn } from '../lib/cn';
import { formatTime } from '../lib/format';

const EMPTY_CHAT: ChatMessage[] = [];

const promptKeys = [
  'assistant.prompt.status',
  'assistant.prompt.disk',
  'assistant.prompt.restart',
  'assistant.prompt.logs',
];

const stateKeys: Record<AgentRunState, string> = {
  idle: 'assistant.state.idle',
  thinking: 'assistant.state.thinking',
  tool: 'assistant.state.tool',
  awaiting_approval: 'assistant.state.awaiting',
  done: 'assistant.state.done',
  error: 'assistant.state.error',
  cancelled: 'assistant.state.cancelled',
};

export function Assistant({ serverId }: { serverId: string }) {
  const chat = useApp((state) => state.chats[serverId]) ?? EMPTY_CHAT;
  const agent = useApp((state) => state.agents[serverId]);
  const providers = useApp((state) => state.providers);
  const settings = useApp((state) => state.settings);
  const profile = useApp((state) => state.profiles[serverId]);
  const sendMessage = useApp((state) => state.sendMessage);
  const cancel = useApp((state) => state.cancel);
  const clearChat = useApp((state) => state.clearChat);
  const setActiveProvider = useApp((state) => state.setActiveProvider);
  const setDialog = useApp((state) => state.setDialog);
  const { t } = useI18n();

  const [input, setInput] = useState('');
  const [stick, setStick] = useState(true);
  const [showUsage, setShowUsage] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const usage = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    for (const message of chat) {
      if (!message.usage) continue;
      inputTokens += message.usage.inputTokens ?? 0;
      outputTokens += message.usage.outputTokens ?? 0;
    }
    return { inputTokens, outputTokens, total: inputTokens + outputTokens };
  }, [chat]);
  const estimatedCost = settings
    ? (usage.inputTokens / 1_000_000) * settings.inputPricePerMTok +
      (usage.outputTokens / 1_000_000) * settings.outputPricePerMTok
    : 0;

  const busy = agent?.state === 'thinking' || agent?.state === 'tool' || agent?.state === 'awaiting_approval';
  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === settings?.activeProviderId) ?? providers[0],
    [providers, settings?.activeProviderId],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onScroll = () => {
      const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 90;
      setStick(nearBottom);
    };
    element.addEventListener('scroll', onScroll);
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!stick) return;
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [chat, agent?.state, stick]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(160, element.scrollHeight)}px`;
  }, [input]);

  const send = (text?: string) => {
    const value = (text ?? input).trim();
    if (!value || busy) return;
    if (!activeProvider) {
      setDialog('settings');
      return;
    }
    setInput('');
    void sendMessage(serverId, value);
  };

  return (
    <div className="flex h-full flex-col bg-[var(--bg)]">
      <header className="flex h-11 flex-none items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-4">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
          <Sparkles size={13} />
        </div>
        <span className="text-[13px] font-semibold text-[var(--text)]">{t('assistant.title')}</span>
        {profile && (
          <span className="truncate text-[12px] text-[var(--muted-2)]">
            {profile.hostname} · {profile.role}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1">

            <Settings2 size={11} className="text-[var(--muted-2)]" />
            <select
              className="w-[128px] truncate bg-transparent text-[12px] text-[var(--muted)] outline-none"
              value={activeProvider?.id ?? ''}
              onChange={(event) => void setActiveProvider(event.target.value)}
            >
              {providers.length === 0 && <option value="">{t('assistant.noProvider')}</option>}
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id} className="bg-[var(--panel-2)] text-[var(--text)]">
                  {provider.name}
                  {provider.kind === 'mock' ? t('assistant.mockSuffix') : ''}
                </option>
              ))}
            </select>
          </div>
          <button
            className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-[11.5px] text-[var(--muted)] transition-colors hover:text-[var(--text)]"
            onClick={() => setShowUsage(true)}
            title={t('usage.title')}
          >
            <Coins size={11} />
            {usage.total >= 1000 ? `${(usage.total / 1000).toFixed(1)}k` : usage.total} tokens
            {estimatedCost > 0 && (
              <span className="text-[var(--muted-2)]">
                · {estimatedCost < 0.01 ? '<¥0.01' : `¥${estimatedCost.toFixed(2)}`}
              </span>
            )}
          </button>
          {busy && (
            <span className="flex items-center gap-1.5 rounded-full bg-sky-400/10 px-2 py-1 text-[11.5px] text-[var(--blue)]">
              <Loader2 size={10} className="spin" />
              {t(stateKeys[agent?.state ?? 'thinking'])}
            </span>
          )}
          <button
            className="btn btn-ghost h-7 w-7 !p-0"
            onClick={() => void clearChat(serverId)}
            title={t('assistant.clear')}
            disabled={chat.length === 0}
          >
            <Eraser size={13} />
          </button>
          {busy && (
            <button className="btn btn-danger h-7 px-2 text-[12px]" onClick={() => void cancel(serverId)}>
              <Square size={10} />
              {t('assistant.stop')}
            </button>
          )}
        </div>
      </header>

      <div ref={scrollRef} className="scroll-area flex-1 px-4 py-4">
        {chat.length === 0 ? (
          <EmptyChat onPick={send} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {chat.map((message) => (
              <MessageItem key={message.id} serverId={serverId} message={message} busy={busy} />
            ))}
            {busy && <ThinkingRow state={agent?.state ?? 'thinking'} />}
            {agent?.state === 'error' && agent.error && (
              <div className="rounded-lg border border-rose-400/25 bg-rose-950/30 px-3 py-2 text-[12.5px] text-[var(--danger)]">
                {agent.error}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-none border-t border-[var(--border)] bg-[var(--panel)] px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <div className="panel-2 flex items-end gap-2 p-1.5 focus-within:border-[rgba(45,212,191,0.4)]">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={busy ? t('assistant.busyPlaceholder') : t('assistant.placeholder')}
              className="max-h-40 flex-1 resize-none bg-transparent px-2.5 py-1.5 text-[13.5px] text-[var(--text)] outline-none placeholder:text-[var(--muted-2)]"
              disabled={busy}
            />
            <button
              className="btn btn-primary h-8 w-8 !p-0"
              onClick={() => send()}
              disabled={busy || !input.trim()}
              title={t('assistant.send')}
            >
              <ArrowUp size={15} />
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between px-0.5 text-[11px] text-[var(--muted-2)]">
            <span>{t('assistant.hint')}</span>
            <span className="flex items-center gap-1">
              <MessageSquare size={10} />
              {activeProvider ? activeProvider.model || activeProvider.name : t('assistant.noProvider')}
            </span>
          </div>
        </div>
      </div>

      {showUsage && <UsageDialog onClose={() => setShowUsage(false)} />}
    </div>
  );
}

function EmptyChat({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-2)]">
        <Sparkles size={24} className="text-[var(--accent)]" />
      </div>
      <div className="text-center">
        <h2 className="text-[16px] font-semibold text-[var(--text)]">{t('assistant.empty.title')}</h2>
        <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-[var(--muted)]">
          {t('assistant.empty.desc')}
        </p>
      </div>
      <div className="grid w-full max-w-lg grid-cols-2 gap-2">
        {promptKeys.map((key) => (
          <button
            key={key}
            onClick={() => onPick(t(key))}
            className="panel-2 px-3 py-2.5 text-left text-[12.5px] leading-relaxed text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ThinkingRow({ state }: { state: AgentRunState }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 px-1 text-[12.5px] text-[var(--muted)]">
      <Loader2 size={13} className="spin text-[var(--accent)]" />
      {state === 'tool'
        ? t('assistant.runningTool')
        : state === 'awaiting_approval'
          ? t('assistant.awaiting')
          : t('assistant.thinking')}
    </div>
  );
}

const MessageItem = memo(function MessageItem({
  serverId,
  message,
  busy,
}: {
  serverId: string;
  message: ChatMessage;
  busy: boolean;
}) {
  const { t } = useI18n();
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] rounded-2xl rounded-br-md border border-[var(--border)] bg-[var(--panel-3)] px-3.5 py-2 text-[13px] leading-relaxed text-[var(--text)]">
          {message.content}
        </div>
      </div>
    );
  }

  const streaming = busy && !message.content.trim() && !message.toolCalls?.length;
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
        <Sparkles size={12} />
      </div>
      <div className="min-w-0 flex-1">
        {streaming ? (
          <div className="flex items-center gap-1.5 py-1 text-[var(--muted-2)]">
            <span className="dot pulse-dot bg-[var(--accent)]" />
            <span className="dot pulse-dot bg-[var(--accent)] [animation-delay:150ms]" />
            <span className="dot pulse-dot bg-[var(--accent)] [animation-delay:300ms]" />
          </div>
        ) : (
          message.content.trim() && <Markdown content={message.content} />
        )}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {message.toolCalls.map((call) => (
              <ToolCallCard key={call.id} serverId={serverId} call={call} />
            ))}
          </div>
        )}
        <div className="mt-1 flex items-center gap-2 text-[10.5px] text-[var(--muted-2)]">
          <span>{formatTime(message.ts)}</span>
          {message.usage?.outputTokens ? <span>· {message.usage.outputTokens} tokens</span> : null}
          {message.interrupted && <span className="text-[var(--warning)]">· {t('assistant.interrupted')}</span>}
        </div>
      </div>
    </div>
  );
});
