type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold: Level = (process.env.SUBSHELL_LOG_LEVEL as Level) ?? 'info';

function write(level: Level, scope: string, message: string, extra?: unknown): void {
  if (order[level] < order[threshold]) return;
  const ts = new Date().toISOString();
  const tail = extra === undefined ? '' : ` ${safeJson(extra)}`;
  const line = `[${ts}] ${level.toUpperCase().padEnd(5)} ${scope}: ${message}${tail}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function safeJson(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  } catch {
    return String(value);
  }
}

export interface Logger {
  debug(message: string, extra?: unknown): void;
  info(message: string, extra?: unknown): void;
  warn(message: string, extra?: unknown): void;
  error(message: string, extra?: unknown): void;
  child(scopeSuffix: string): Logger;
}

/** 创建带作用域前缀的日志器。 */
export function createLogger(scope: string): Logger {
  return {
    debug: (m, e) => write('debug', scope, m, e),
    info: (m, e) => write('info', scope, m, e),
    warn: (m, e) => write('warn', scope, m, e),
    error: (m, e) => write('error', scope, m, e),
    child: (suffix) => createLogger(`${scope}:${suffix}`),
  };
}
