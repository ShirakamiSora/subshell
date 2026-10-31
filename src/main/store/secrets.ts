import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import type { ServerSecretInput } from '../../shared/types';
import { createLogger } from '../util/logger';

const log = createLogger('secrets');

interface SecretRecord {
  /** 1 = 系统凭据库（DPAPI / Keychain / libsecret），0 = 仅本地编码（不加密） */
  v: 0 | 1;
  payload: string;
}

type SecretFile = Record<string, SecretRecord>;

/**
 * 凭据存储。密码、私钥口令和私钥内容只保存在系统凭据库加密后的本地文件中，
 * 绝不进入 servers.json、日志、对话记录或服务器档案。
 */
export class SecretStore {
  private cache: SecretFile | null = null;
  private encryptionAvailable: boolean;

  constructor(private readonly file: string) {
    this.encryptionAvailable = safeStorage.isEncryptionAvailable();
    if (!this.encryptionAvailable) {
      log.warn('系统凭据库不可用，凭据将以未加密形式保存在本地文件中');
    }
  }

  private load(): SecretFile {
    if (this.cache) return this.cache;
    try {
      this.cache = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as SecretFile) : {};
    } catch (error) {
      log.error('凭据文件读取失败，已重置', error);
      this.cache = {};
    }
    return this.cache;
  }

  private persist(value: SecretFile): void {
    this.cache = value;
    mkdirSync(join(this.file, '..'), { recursive: true });
    const tmp = `${this.file}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(value), 'utf8');
    renameSync(tmp, this.file);
  }

  has(serverId: string): boolean {
    return Boolean(this.load()[serverId]);
  }

  get(serverId: string): ServerSecretInput | null {
    const record = this.load()[serverId];
    if (!record) return null;
    try {
      const text =
        record.v === 1 && this.encryptionAvailable
          ? safeStorage.decryptString(Buffer.from(record.payload, 'base64'))
          : Buffer.from(record.payload, 'base64').toString('utf8');
      return JSON.parse(text) as ServerSecretInput;
    } catch (error) {
      log.error(`凭据解密失败: ${serverId}`, error);
      return null;
    }
  }

  set(serverId: string, secret: ServerSecretInput): void {
    const text = JSON.stringify(secret);
    const record: SecretRecord = this.encryptionAvailable
      ? { v: 1, payload: safeStorage.encryptString(text).toString('base64') }
      : { v: 0, payload: Buffer.from(text, 'utf8').toString('base64') };
    this.persist({ ...this.load(), [serverId]: record });
  }

  delete(serverId: string): void {
    const next = { ...this.load() };
    delete next[serverId];
    this.persist(next);
  }
}
