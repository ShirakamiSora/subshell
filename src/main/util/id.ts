import { randomUUID } from 'node:crypto';

/** 生成短小且唯一的 ID，用于会话、事件、工具调用等运行期对象。 */
export function shortId(prefix = ''): string {
  const raw = randomUUID().replace(/-/g, '').slice(0, 12);
  return prefix ? `${prefix}_${raw}` : raw;
}

/** 生成稳定的服务器 ID（可读前缀 + 随机后缀）。 */
export function serverId(): string {
  return shortId('srv');
}

/** 生成消息 ID。 */
export function messageId(): string {
  return shortId('msg');
}

/** 生成工具调用 ID。 */
export function toolCallId(): string {
  return shortId('call');
}
