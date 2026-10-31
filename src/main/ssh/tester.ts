import type { ExecOptions, ServerConfig } from '../../shared/types';
import { SshConnection } from './connection';
import type { ServerSecretInput } from '../../shared/types';

/** 测试连接（不写入服务器列表，也不记录主机指纹）。 */
export async function testConnection(
  config: ServerConfig,
  secret: ServerSecretInput | null,
): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
  const connection = new SshConnection({
    server: config,
    secret,
    verifyHostKey: () => true,
  });
  try {
    await connection.connect();
    const result = await connection.exec('echo subshell-ok', { timeoutMs: 10_000 } as ExecOptions);
    return {
      ok: result.stdout.includes('subshell-ok'),
      latencyMs: connection.latencyMs,
      error: result.stdout.includes('subshell-ok') ? undefined : result.stderr || '命令执行失败',
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    connection.disconnect();
  }
}
