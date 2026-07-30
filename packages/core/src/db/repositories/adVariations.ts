import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { adVariations, type AdVariation, type NewAdVariation } from '../schema.js';

/** 광고 "대안"(variation) 저장소 — 대안별 사이즈·문구·스크린샷을 (ad_id, idx) 멱등 upsert 로 보존 */
export class AdVariationRepository {
  constructor(private readonly db: Db) {}

  /** 대안 메타데이터 upsert. 스크린샷은 건드리지 않는다(별도 saveScreenshot). */
  async upsert(input: Omit<NewAdVariation, 'screenshot'>): Promise<AdVariation> {
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

  /** 스크린샷 저장 — 대안 행이 없으면 만들고(사이즈만), 있으면 스크린샷만 갱신 */
  async saveScreenshot(
    adId: string,
    idx: number,
    png: Buffer,
    size?: { width?: number; height?: number },
  ): Promise<void> {
    await this.db
      .insert(adVariations)
      .values({ adId, idx, width: size?.width ?? null, height: size?.height ?? null, screenshot: png })
      .onConflictDoUpdate({
        target: [adVariations.adId, adVariations.idx],
        set: {
          screenshot: png,
          // 사이즈는 새 값이 있을 때만 갱신
          width: sql`coalesce(${size?.width ?? null}, ${adVariations.width})`,
          height: sql`coalesce(${size?.height ?? null}, ${adVariations.height})`,
          collectedAt: new Date(),
        },
      });
  }

  /** 상세 페이지용 — 스크린샷 바이너리는 제외(용량), 존재 여부만 */
  async listByAd(adId: string): Promise<Array<Omit<AdVariation, 'screenshot'> & { hasScreenshot: boolean }>> {
    const rows = await this.db
      .select({
        id: adVariations.id,
        adId: adVariations.adId,
        idx: adVariations.idx,
        width: adVariations.width,
        height: adVariations.height,
        headline: adVariations.headline,
        description: adVariations.description,
        ctaText: adVariations.ctaText,
        logoUrl: adVariations.logoUrl,
        imageUrl: adVariations.imageUrl,
        landingUrl: adVariations.landingUrl,
        collectedAt: adVariations.collectedAt,
        hasScreenshot: sql<boolean>`(${adVariations.screenshot} is not null)`,
      })
      .from(adVariations)
      .where(eq(adVariations.adId, adId))
      .orderBy(adVariations.idx);
    return rows;
  }

  /** 스크린샷 스트리밍용 단건 조회 */
  async getScreenshot(id: string): Promise<Buffer | null> {
    const rows = await this.db
      .select({ screenshot: adVariations.screenshot })
      .from(adVariations)
      .where(eq(adVariations.id, id))
      .limit(1);
    return rows[0]?.screenshot ?? null;
  }

  /** (ad_id, idx) 로 단건 조회 — 확장 캡처 업로드 시 사용 */
  async findByAdIdx(adId: string, idx: number): Promise<AdVariation | undefined> {
    const rows = await this.db
      .select()
      .from(adVariations)
      .where(and(eq(adVariations.adId, adId), eq(adVariations.idx, idx)))
      .limit(1);
    return rows[0];
  }
}
