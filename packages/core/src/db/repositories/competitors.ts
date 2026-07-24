import { desc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { competitors, type Competitor, type NewCompetitor } from '../schema.js';

export class CompetitorRepository {
  constructor(private readonly db: Db) {}

  async listActive(): Promise<Competitor[]> {
    return this.db.select().from(competitors).where(eq(competitors.isActive, true));
  }

  /** 대시보드 관리 화면용 — 전체 경쟁사(비활성 포함), 최신 등록순 */
  async listAll(): Promise<Competitor[]> {
    return this.db.select().from(competitors).orderBy(desc(competitors.createdAt));
  }

  /** 활성/비활성 전환 (삭제 대신 비활성으로 수집 제외) */
  async setActive(id: string, isActive: boolean): Promise<void> {
    await this.db.update(competitors).set({ isActive }).where(eq(competitors.id, id));
  }

  /** 경쟁사 삭제 (연관 ads·ad_metrics 는 FK cascade 로 함께 삭제) */
  async remove(id: string): Promise<void> {
    await this.db.delete(competitors).where(eq(competitors.id, id));
  }

  async findById(id: string): Promise<Competitor | undefined> {
    const rows = await this.db.select().from(competitors).where(eq(competitors.id, id)).limit(1);
    return rows[0];
  }

  async findByAdvertiserId(advertiserId: string): Promise<Competitor | undefined> {
    const rows = await this.db
      .select()
      .from(competitors)
      .where(eq(competitors.advertiserId, advertiserId))
      .limit(1);
    return rows[0];
  }

  /** advertiser_id 기준 멱등 등록 (재실행 안전) */
  async upsert(input: NewCompetitor): Promise<Competitor> {
    const rows = await this.db
      .insert(competitors)
      .values(input)
      .onConflictDoUpdate({
        target: competitors.advertiserId,
        set: { name: input.name, domain: input.domain, region: input.region },
      })
      .returning();
    return rows[0]!;
  }
}
