import { eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { collectionRuns, type CollectionRun, type NewCollectionRun } from '../schema.js';

export class CollectionRunRepository {
  constructor(private readonly db: Db) {}

  async start(kind: NewCollectionRun['kind']): Promise<CollectionRun> {
    const rows = await this.db
      .insert(collectionRuns)
      .values({ kind, status: 'success' })
      .returning();
    return rows[0]!;
  }

  async finish(
    id: string,
    patch: { status: CollectionRun['status']; newAdsCount?: number; apiCallCount?: number; errorMessage?: string },
  ): Promise<void> {
    await this.db
      .update(collectionRuns)
      .set({
        status: patch.status,
        newAdsCount: patch.newAdsCount ?? 0,
        apiCallCount: patch.apiCallCount ?? 0,
        errorMessage: patch.errorMessage,
        finishedAt: new Date(),
      })
      .where(eq(collectionRuns.id, id));
  }

  /** 이번 달 누적 API 호출 수 (쿼터 가드 초기화용) */
  async apiCallsSince(since: Date): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(${collectionRuns.apiCallCount}), 0)` })
      .from(collectionRuns)
      .where(gte(collectionRuns.startedAt, since));
    return Number(rows[0]?.total ?? 0);
  }

  async recent(limit = 20): Promise<CollectionRun[]> {
    return this.db
      .select()
      .from(collectionRuns)
      .orderBy(sql`${collectionRuns.startedAt} desc`)
      .limit(limit);
  }
}
