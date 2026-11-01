import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { ClipboardCopy, Eraser, RotateCw, Sparkles, TerminalSquare, WifiOff, Loader2 } from 'lucide-react';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { suggestCommands, type CommandSuggestion } from '../lib/commands';
import { CommandDialog } from '../components/CommandDialog';
import { useI18n } from '../lib/i18n';

type SessionState = 'opening' | 'ready' | 'closed' | 'error';

const theme = {
  background: '#070a10',
  foreground: '#d7e2f4',
  cursor: '#2dd4bf',
  cursorAccent: '#070a10',
  selectionBackground: 'rgba(45, 212, 191, 0.28)',
  black: '#1b2436',
  red: '#f87171',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e2e8f0',
  brightBlack: '#64748b',
  brightRed: '#fca5a5',
  brightGreen: '#6ee7b7',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f8fafc',
};

export function TerminalView({ serverId, active = true }: { serverId: string; active?: boolean }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const startRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<SessionState>('opening');
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<CommandSuggestion[]>([]);
  const [showAnalyze, setShowAnalyze] = useState(false);
  const bufferRef = useRef('');
  const connection = useApp((state) => state.connections[serverId]);
  const connect = useApp((state) => state.connect);
  const fontSize = useApp((state) => state.settings?.terminalFontSize ?? 14);
  const connected = connection?.state === 'connected';

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new XTerm({
      fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, 'SF Mono', monospace",
      fontSize,
      lineHeight: 1.35,
      cursorBlink: true,
      scrollback: 6000,
      theme,
      allowProposedApi: true,
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      // 容器尚不可见时忽略
    }

    let disposed = false;

    const startSession = async () => {
      if (sessionRef.current) {
        void api.terminal.close(sessionRef.current);
        sessionRef.current = null;
      }
      setStatus('opening');
      setError('');
      try {
        fit.fit();
      } catch {
        // ignore
      }
      term.reset();
      try {
        const id = await api.terminal.open(serverId, term.cols, term.rows);
        if (disposed) {
          void api.terminal.close(id);
          return;
        }
        sessionRef.current = id;
        term.clear();
        term.write('\x1b[H');
        setStatus('ready');
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    startRef.current = () => void startSession();
    void startSession();

    const offData = api.events.on('terminal:data', ({ sessionId: id, data }) => {
      if (id === sessionRef.current) term.write(data);
    });
    const offExit = api.events.on('terminal:exit', ({ sessionId: id }) => {
      if (id === sessionRef.current) {
        sessionRef.current = null;
        setStatus('closed');
        term.writeln(`\r\n\x1b[38;2;248;113;113m${t('terminal.disconnected')}\x1b[0m`);
      }
    });
    const dataDisposable = term.onData((data) => {
      // Tab：不发给远端，改为本地命令补全
      if (data === '\t') {
        setSuggestions(suggestCommands(bufferRef.current));
        return;
      }
      if (data === '\x1b') {
        setSuggestions([]);
        return;
      }
      if (data === '\r' || data === '\n') bufferRef.current = '';
      else if (data === '\x7f') bufferRef.current = bufferRef.current.slice(0, -1);
      else if (data >= ' ') bufferRef.current += data;
      if (sessionRef.current) void api.terminal.write(sessionRef.current, data);
    });

    const observer = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return;
      try {
        fitRef.current.fit();
      } catch {
        // ignore
      }
      const id = sessionRef.current;
      if (id) void api.terminal.resize(id, term.cols, term.rows);
    });
    observer.observe(container);

    return () => {
      disposed = true;
      offData();
      offExit();
      dataDisposable.dispose();
      observer.disconnect();
      if (sessionRef.current) void api.terminal.close(sessionRef.current);
      sessionRef.current = null;
      startRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // 仅在切换服务器时重建终端
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.fontSize = fontSize;
    try {
      fitRef.current?.fit();
    } catch {
      // ignore
    }
  }, [fontSize]);

  // 隐藏时关闭光标闪烁，减少后台渲染开销。
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.cursorBlink = active;
    if (active) {
      try {
        fitRef.current?.fit();
      } catch {
        // ignore
      }
    }
  }, [active]);

  const copySelection = async () => {
    const selection = termRef.current?.getSelection() ?? '';
    if (!selection) return;
    await navigator.clipboard.writeText(selection);
  };

  const paste = async () => {
    const text = await navigator.clipboard.readText();
    if (text && sessionRef.current) await api.terminal.write(sessionRef.current, text);
  };

  const acceptSuggestion = (suggestion: CommandSuggestion) => {
    const id = sessionRef.current;
    if (!id) return;
    // 清掉当前行已输入的内容后插入补全文本
    const clear = '\x7f'.repeat(bufferRef.current.length);
    void api.terminal.write(id, clear + suggestion.insert);
    bufferRef.current = suggestion.insert;
    setSuggestions([]);
    termRef.current?.focus();
  };

  return (
    <div className="flex h-full flex-col bg-[var(--bg)]">
      <div className="flex h-9 flex-none items-center gap-1 border-b border-[var(--border)] bg-[var(--panel)] px-3">
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--muted-2)]">
          <TerminalSquare size={12} />
          {t('terminal.title')}
        </span>
        <span
          className={cn(
            'ml-2 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px]',
            status === 'ready' && 'bg-emerald-400/10 text-[var(--success)]',
            status === 'opening' && 'bg-amber-400/10 text-[var(--warning)]',
            (status === 'closed' || status === 'error') && 'bg-rose-400/10 text-[var(--danger)]',
          )}
        >
          {status === 'opening' && <Loader2 size={9} className="spin" />}
          {status === 'ready'
            ? t('terminal.status.ready')
            : status === 'opening'
              ? t('terminal.status.opening')
              : status === 'closed'
                ? t('terminal.status.closed')
                : t('terminal.status.error')}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            className="btn btn-ghost h-7 px-2 text-[12px]"
            onClick={() => setShowAnalyze(true)}
            title={t('terminal.action.analyzeTitle')}
          >
            <Sparkles size={12} />
            {t('terminal.action.analyze')}
          </button>
          <button
            className="btn btn-ghost h-7 px-2 text-[12px]"
            onClick={copySelection}
            title={t('terminal.action.copyTitle')}
          >
            <ClipboardCopy size={12} />
            {t('terminal.action.copy')}
          </button>
          <button className="btn btn-ghost h-7 px-2 text-[12px]" onClick={() => void paste()} title={t('terminal.action.paste')}>
            {t('terminal.action.paste')}
          </button>
          <button
            className="btn btn-ghost h-7 px-2 text-[12px]"
            onClick={() => {
              termRef.current?.clear();
            }}
            title={t('terminal.action.clear')}
          >
            <Eraser size={12} />
            {t('terminal.action.clear')}
          </button>
          <button
            className="btn btn-ghost h-7 px-2 text-[12px]"
            onClick={() => startRef.current?.()}
            title={t('terminal.action.reconnectTitle')}
          >
            <RotateCw size={12} />
            {t('terminal.action.reconnect')}
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="xterm-wrap absolute inset-0" />

        {suggestions.length > 0 && (
          <div className="absolute bottom-3 left-3 z-30 w-[440px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
            <div className="border-b border-[var(--border)] px-2.5 py-1.5 text-[11px] text-[var(--muted-2)]">
              {t('terminal.suggest.title')}
            </div>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.name}
                onClick={() => acceptSuggestion(suggestion)}
                className="flex w-full items-center gap-3 px-2.5 py-1.5 text-left hover:bg-[var(--panel-3)]"
              >
                <span className="mono flex-none text-[12px] text-[var(--text)]">{suggestion.name}</span>
                <span className="truncate text-[11.5px] text-[var(--muted-2)]">{suggestion.description}</span>
              </button>
            ))}
          </div>
        )}
        {status === 'opening' && connected && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-[var(--bg)]/80 text-[12.5px] text-[var(--muted)]">
            <Loader2 size={14} className="spin text-[var(--accent)]" />
            {t('terminal.connecting')}
          </div>
        )}
        {!connected && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--bg)]/92 ">
            <WifiOff size={24} className="text-[var(--muted-2)]" />
            <div className="text-[13px] text-[var(--muted)]">
              {connection?.state === 'connecting' ? t('terminal.connectingHost') : t('terminal.notConnected')}
            </div>
            {connection?.error && <div className="max-w-md text-center text-[12px] text-[var(--danger)]">{connection.error}</div>}
            {connection?.state !== 'connecting' && (
              <button className="btn btn-primary" onClick={() => void connect(serverId)}>
                {t('overview.connect')}
              </button>
            )}
          </div>
        )}
      </div>

      {status === 'error' && (
        <div className="flex-none border-t border-rose-400/20 bg-rose-950/40 px-3 py-1.5 text-[12px] text-[var(--danger)]">
          {error || t('terminal.openFailed')}
        </div>
      )}

      {showAnalyze && (
        <CommandDialog
          serverId={serverId}
          onClose={() => setShowAnalyze(false)}
          onInsert={(command) => {
            if (sessionRef.current) void api.terminal.write(sessionRef.current, command);
            bufferRef.current = command;
            setShowAnalyze(false);
            termRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
