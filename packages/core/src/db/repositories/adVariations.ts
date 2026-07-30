import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { adVariations, type AdVariation, type NewAdVariation } from '../schema.js';

/** 광고 "대안"(variation) 저장소 — 대안별 사이즈·문구를 (ad_id, idx) 멱등 upsert 로 보존 */
export class AdVariationRepository {
  constructor(private readonly db: Db) {}

  async upsert(input: NewAdVariation): Promise<AdVariation> {
    const rows = await this.db
      .insert(adVariations)
      .values(input)
      .onConflictDoUpdate({
        target: [adVariations.adId, adVariations.idx],
        set: {
          width: input.width,
          height: input.height,
          headline: input.headline,
          description: input.description,
          ctaText: input.ctaText,
          logoUrl: input.logoUrl,
          imageUrl: input.imageUrl,
          landingUrl: input.landingUrl,
          collectedAt: input.collectedAt ?? new Date(),
        },
      })
      .returning();
    return rows[0]!;
  }

  /** 광고의 대안 목록 (idx 순) */
  async listByAd(adId: string): Promise<AdVariation[]> {
    return this.db.select().from(adVariations).where(eq(adVariations.adId, adId)).orderBy(adVariations.idx);
  }
}
