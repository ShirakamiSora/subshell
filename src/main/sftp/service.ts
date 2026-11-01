import { dialog } from 'electron';
import { basename } from 'node:path';
import type { RemoteEntry } from '../../shared/types';
import type { SshManager } from '../ssh/manager';
import { createLogger } from '../util/logger';

const log = createLogger('sftp');

export interface RemoteTextResult {
  ok: boolean;
  content?: string;
  binary?: boolean;
  error?: string;
  truncated?: boolean;
}

function joinRemote(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

/**
 * 文件传输服务。所有路径校验交给远端文件系统权限，
 * 但主进程只暴露明确的操作，渲染层无法拼出任意 SFTP 请求。
 */
export class SftpService {
  constructor(private readonly ssh: SshManager) {}

  async home(serverId: string): Promise<string> {
    const connection = await this.ssh.ensureConnected(serverId);
    return connection.homeDir();
  }

  async list(serverId: string, path: string): Promise<RemoteEntry[]> {
    const connection = await this.ssh.ensureConnected(serverId);
    return connection.listDir(path);
  }

  async preview(serverId: string, path: string): Promise<RemoteTextResult> {
    try {
      const connection = await this.ssh.ensureConnected(serverId);
      const text = await connection.readTextFile(path);
      // 含 NUL 基本可以判定为二进制，直接返回标记而不是把乱码塞进界面。
      if (text.includes('\u0000')) return { ok: true, binary: true };
      return { ok: true, content: text };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async download(serverId: string, remotePath: string): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
    const target = await dialog.showSaveDialog({
      title: '保存远程文件',
      defaultPath: basename(remotePath),
    });
    if (target.canceled || !target.filePath) return { ok: false, canceled: true };
    try {
      const connection = await this.ssh.ensureConnected(serverId);
      await connection.downloadFile(remotePath, target.filePath);
      log.info(`下载完成 ${remotePath} -> ${target.filePath}`);
      return { ok: true, path: target.filePath };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async upload(
    serverId: string,
    remoteDir: string,
  ): Promise<{ ok: boolean; files?: string[]; canceled?: boolean; error?: string }> {
    const picked = await dialog.showOpenDialog({
      title: '选择要上传的文件',
      properties: ['openFile', 'multiSelections'],
    });
    if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true };
    try {
      const connection = await this.ssh.ensureConnected(serverId);
      const uploaded: string[] = [];
      for (const localPath of picked.filePaths) {
        const remotePath = joinRemote(remoteDir, basename(localPath));
        await connection.uploadFile(localPath, remotePath);
        uploaded.push(remotePath);
      }
      log.info(`上传完成 ${uploaded.length} 个文件 -> ${remoteDir}`);
      return { ok: true, files: uploaded };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async mkdir(serverId: string, path: string): Promise<void> {
    const connection = await this.ssh.ensureConnected(serverId);
    await connection.makeDir(path);
  }

  async rename(serverId: string, from: string, to: string): Promise<void> {
    const connection = await this.ssh.ensureConnected(serverId);
    await connection.renamePath(from, to);
  }

  async remove(serverId: string, path: string, isDir: boolean): Promise<void> {
    const connection = await this.ssh.ensureConnected(serverId);
    await connection.removePath(path, isDir);
  }
}
