import { and, eq, inArray, isNotNull, isNull, not, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { ads, type Ad, type NewAd } from '../schema.js';

export class AdRepository {
  constructor(private readonly db: Db) {}

  /**
   * creative_id 목록 중 이미 저장된 것을 반환 (신규 감지용).
   *
   * ⚠️ 단, **불완전 수집분은 "기존"으로 보지 않는다** — 재수집 대상(upsert 로 삭제 없이 제자리 보강):
   *  1) 이미지·텍스트 광고 중 `raw` 없음 — 구버전 파이프라인 수집분(문구·CTA·랜딩 누락).
   *  2) **썸네일이 될 시각 요소가 하나도 없는 광고** — youtube_video_id·image_url·headline·
   *     description 전부 null (목록에서 빈 placeholder 로 보이는 것들). 일시 오류로 비었던
   *     광고가 다음 수집에서 자동 복구된다.
   */
  async existingCreativeIds(creativeIds: string[]): Promise<Set<string>> {
    if (creativeIds.length === 0) return new Set();
    const incompleteLegacy = and(inArray(ads.format, ['image', 'text']), isNull(ads.raw))!;
    const noVisual = and(
      isNull(ads.youtubeVideoId),
      isNull(ads.imageUrl),
      isNull(ads.headline),
      isNull(ads.description),
    )!;
    const rows = await this.db
      .select({ creativeId: ads.creativeId })
      .from(ads)
      .where(and(inArray(ads.creativeId, creativeIds), not(or(incompleteLegacy, noVisual)!)));
    return new Set(rows.map((r) => r.creativeId));
  }

  /**
   * creative_id 기준 멱등 upsert. 기존 광고는 게재 기간/최종 게재일만 갱신하고
   * raw·collected 는 최신값으로 덮는다. 재실행 시 중복 행이 생기지 않는다.
   */
  async upsertByCreativeId(input: NewAd): Promise<Ad> {
    const rows = await this.db
      .insert(ads)
      .values(input)
      .onConflictDoUpdate({
        target: ads.creativeId,
        set: {
          lastShown: input.lastShown,
          daysShown: input.daysShown,
          platforms: input.platforms,
          videoUrl: input.videoUrl,
          youtubeVideoId: input.youtubeVideoId,
          imageUrl: input.imageUrl,
          headline: input.headline,
          description: input.description,
          ctaText: input.ctaText,
          logoUrl: input.logoUrl,
          thumbnailPath: input.thumbnailPath,
          landingUrl: input.landingUrl,
          landingDomain: input.landingDomain,
          // 게시일은 안정적이므로 새 값이 있을 때만 갱신(없으면 기존값 유지)
          publishedAt: sql`coalesce(excluded.published_at, ads.published_at)`,
          regions: input.regions,
          raw: input.raw,
          collectedAt: input.collectedAt ?? new Date(),
        },
      })
      .returning();
    return rows[0]!;
  }

  /** youtube_video_id 를 가진 광고 (조회수 수집 대상). 게시일 백필 판단용으로 publishedAt 포함. */
  async withYouTubeId(): Promise<Pick<Ad, 'id' | 'youtubeVideoId' | 'publishedAt'>[]> {
    return this.db
      .select({ id: ads.id, youtubeVideoId: ads.youtubeVideoId, publishedAt: ads.publishedAt })
      .from(ads)
      .where(isNotNull(ads.youtubeVideoId));
  }

  /** 영상 게시일 백필 — 아직 없을 때만 설정(게시일은 불변). */
  async setPublishedAt(id: string, publishedAt: Date): Promise<void> {
    await this.db.update(ads).set({ publishedAt }).where(eq(ads.id, id));
  }

  async findById(id: string): Promise<Ad | undefined> {
    const rows = await this.db.select().from(ads).where(eq(ads.id, id)).limit(1);
    return rows[0];
  }
}
