import { eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../client.js';
import { ads, type Ad, type NewAd } from '../schema.js';

export class AdRepository {
  constructor(private readonly db: Db) {}

  /** creative_id 목록 중 이미 저장된 것을 반환 (신규 감지용) */
  async existingCreativeIds(creativeIds: string[]): Promise<Set<string>> {
    if (creativeIds.length === 0) return new Set();
    const rows = await this.db
      .select({ creativeId: ads.creativeId })
      .from(ads)
      .where(inArray(ads.creativeId, creativeIds));
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
          thumbnailPath: input.thumbnailPath,
          landingUrl: input.landingUrl,
          landingDomain: input.landingDomain,
          regions: input.regions,
          raw: input.raw,
          collectedAt: input.collectedAt ?? new Date(),
        },
      })
      .returning();
    return rows[0]!;
  }

  /** youtube_video_id 를 가진 광고 (조회수 수집 대상) */
  async withYouTubeId(): Promise<Pick<Ad, 'id' | 'youtubeVideoId'>[]> {
    return this.db
      .select({ id: ads.id, youtubeVideoId: ads.youtubeVideoId })
      .from(ads)
      .where(isNotNull(ads.youtubeVideoId));
  }

  async findById(id: string): Promise<Ad | undefined> {
    const rows = await this.db.select().from(ads).where(eq(ads.id, id)).limit(1);
    return rows[0];
  }
}
