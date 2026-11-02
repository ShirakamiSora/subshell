import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage } from '../../shared/types';
import type { SubshellDb } from './db';

/**
 * 每个服务器独立的对话记录，存放在 SQLite 的 `chat:<serverId>` 文档中。
 * 每次变更立即写入，保证关闭应用后对话可以继续使用。
 */
export class ChatStore {
  private cache = new Map<string, ChatMessage[]>();
  private readonly db: SubshellDb;

  constructor(db: SubshellDb) {
    this.db = db;
  }

  list(serverId: string): ChatMessage[] {
    const cached = this.cache.get(serverId);
    if (cached) return cached;
    let messages: ChatMessage[] = [];
    const raw = this.db.doc(`chat:${serverId}`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed)) messages = parsed;
      } catch {
        messages = [];
      }
    } else {
      messages = this.importLegacy(serverId);
    }
    this.cache.set(serverId, messages);
    return messages;
  }

  private importLegacy(serverId: string): ChatMessage[] {
    const file = join(this.db.dataDir, 'servers', serverId, 'chat.json');
    if (!existsSync(file)) return [];
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as ChatMessage[];
      const messages = Array.isArray(parsed) ? parsed : [];
      this.db.setDoc(`chat:${serverId}`, JSON.stringify(messages));
      return messages;
    } catch {
      return [];
    }
  }

  private persist(serverId: string, messages: ChatMessage[]): void {
    this.cache.set(serverId, messages);
    try {
      this.db.setDoc(`chat:${serverId}`, JSON.stringify(messages));
    } catch (error) {
      console.error(`[chat] 写入失败: ${serverId}`, error);
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

  remove(serverId: string): void {
    this.cache.delete(serverId);
    this.db.deleteDoc(`chat:${serverId}`);
  }

  /** 已改为同步写盘，保留接口兼容。 */
  flush(): void {
    // no-op
  }

  dispose(): void {
    // no-op
  }
}
