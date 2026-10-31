import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage } from '../../shared/types';

/**
 * 每个服务器独立的对话记录。
 * 每次变更立即同步写盘，保证关闭应用后对话可以继续使用。
 */
export class ChatStore {
  private cache = new Map<string, ChatMessage[]>();

  constructor(private readonly dataDir: string) {}

  private file(serverId: string): string {
    return join(this.dataDir, 'servers', serverId, 'chat.json');
  }

  list(serverId: string): ChatMessage[] {
    const cached = this.cache.get(serverId);
    if (cached) return cached;
    let messages: ChatMessage[] = [];
    const file = this.file(serverId);
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as ChatMessage[];
        if (Array.isArray(parsed)) messages = parsed;
      } catch {
        messages = [];
      }
    }
    this.cache.set(serverId, messages);
    return messages;
  }

  private persist(serverId: string, messages: ChatMessage[]): void {
    this.cache.set(serverId, messages);
    try {
      const file = this.file(serverId);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, JSON.stringify(messages), 'utf8');
    } catch (error) {
      console.error(`[chat] 写盘失败: ${serverId}`, error);
    }
  }

  append(serverId: string, message: ChatMessage): ChatMessage[] {
    const messages = [...this.list(serverId), message];
    this.persist(serverId, messages);
    return messages;
  }

  replace(serverId: string, messages: ChatMessage[]): void {
    this.persist(serverId, messages);
  }

  updateMessage(serverId: string, messageId: string, patch: Partial<ChatMessage>): ChatMessage | null {
    const messages = this.list(serverId).map((item) =>
      item.id === messageId ? { ...item, ...patch } : item,
    );
    this.persist(serverId, messages);
    return messages.find((item) => item.id === messageId) ?? null;
  }

  clear(serverId: string): void {
    this.persist(serverId, []);
  }

  /** 已改为同步写盘，保留接口兼容。 */
  flush(): void {
    // no-op
  }

  dispose(): void {
    // no-op
  }
}
