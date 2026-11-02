import type { ClusterRun } from '../../shared/types';
import type { SubshellDb } from './db';
import { SqliteStore } from './sqlite-store';

/** 集群任务历史（只保留最近若干次，避免无限增长）。 */
export class ClusterStore {
  private readonly store: SqliteStore<ClusterRun[]>;

  constructor(db: SubshellDb) {
    this.store = new SqliteStore<ClusterRun[]>(db, 'cluster-runs', () => [], { version: 1 });
  }

  list(limit = 20): ClusterRun[] {
    return this.store.read().slice(0, Math.max(1, Math.min(limit, 100)));
  }

  save(run: ClusterRun): ClusterRun[] {
    const others = this.store.read().filter((item) => item.id !== run.id);
    const next = [run, ...others].slice(0, 100);
    this.store.write(next);
    return next;
  }
}
