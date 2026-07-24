import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { competitors, type Competitor, type NewCompetitor } from '../schema.js';

export class CompetitorRepository {
  constructor(private readonly db: Db) {}

  async listActive(): Promise<Competitor[]> {
    return this.db.select().from(competitors).where(eq(competitors.isActive, true));
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
