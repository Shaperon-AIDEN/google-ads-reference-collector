import { schema } from '@adref/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from './db';

const { ads, adMetrics, competitors, collectionRuns } = schema;

export type AdSort = 'newest' | 'views' | 'duration';

export interface AdListFilter {
  competitorId?: string;
  format?: 'video' | 'image' | 'text';
  sort?: AdSort;
}

export interface AdCard {
  id: string;
  creativeId: string;
  competitorId: string;
  competitorName: string;
  format: string;
  firstShown: string | null;
  lastShown: string | null;
  daysShown: number | null;
  youtubeVideoId: string | null;
  thumbnailPath: string | null;
  landingUrl: string | null;
  latestViews: number | null;
}

// 각 광고의 최신 조회수 스냅샷 서브쿼리.
// ⚠️ Drizzle 의 ${ads.id} 는 한정자 없이 "id" 로 렌더돼 서브쿼리 내 다른 테이블(ad_metrics.id)에
//    바인딩되는 버그가 있어, 상관 컬럼은 리터럴 SQL(ads.id)로 명시한다.
const latestViewsSql = sql<number>`(
  SELECT m.yt_view_count FROM ad_metrics m
  WHERE m.ad_id = ads.id
  ORDER BY m.snapshot_date DESC LIMIT 1
)`;

/** 레퍼런스 리스트 (메인) — 경쟁사명 조인 + 최신 조회수, 정렬·필터 */
export async function listAds(filter: AdListFilter = {}): Promise<AdCard[]> {
  const conds = [];
  if (filter.competitorId) conds.push(eq(ads.competitorId, filter.competitorId));
  if (filter.format) conds.push(eq(ads.format, filter.format));

  const order =
    filter.sort === 'views'
      ? desc(latestViewsSql)
      : filter.sort === 'duration'
        ? desc(ads.daysShown)
        : desc(ads.collectedAt);

  const rows = await db()
    .select({
      id: ads.id,
      creativeId: ads.creativeId,
      competitorId: ads.competitorId,
      competitorName: competitors.name,
      format: ads.format,
      firstShown: ads.firstShown,
      lastShown: ads.lastShown,
      daysShown: ads.daysShown,
      youtubeVideoId: ads.youtubeVideoId,
      thumbnailPath: ads.thumbnailPath,
      landingUrl: ads.landingUrl,
      latestViews: latestViewsSql,
    })
    .from(ads)
    .innerJoin(competitors, eq(competitors.id, ads.competitorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(order)
    .limit(500);

  return rows.map((r) => ({ ...r, latestViews: r.latestViews == null ? null : Number(r.latestViews) }));
}

export interface AdDetailView extends AdCard {
  landingDomain: string | null;
  videoUrl: string | null;
  advertiserId: string;
  metrics: Array<{ date: string; views: number | null; likes: number | null }>;
}

/** 광고 상세 — 조회수 성장(일별 스냅샷) 포함 */
export async function getAd(id: string): Promise<AdDetailView | null> {
  const rows = await db()
    .select({
      id: ads.id,
      creativeId: ads.creativeId,
      competitorId: ads.competitorId,
      competitorName: competitors.name,
      format: ads.format,
      firstShown: ads.firstShown,
      lastShown: ads.lastShown,
      daysShown: ads.daysShown,
      youtubeVideoId: ads.youtubeVideoId,
      thumbnailPath: ads.thumbnailPath,
      landingUrl: ads.landingUrl,
      landingDomain: ads.landingDomain,
      videoUrl: ads.videoUrl,
      advertiserId: competitors.advertiserId,
      latestViews: latestViewsSql,
    })
    .from(ads)
    .innerJoin(competitors, eq(competitors.id, ads.competitorId))
    .where(eq(ads.id, id))
    .limit(1);

  const ad = rows[0];
  if (!ad) return null;

  const metrics = await db()
    .select({
      date: adMetrics.snapshotDate,
      views: adMetrics.ytViewCount,
      likes: adMetrics.ytLikeCount,
    })
    .from(adMetrics)
    .where(eq(adMetrics.adId, id))
    .orderBy(adMetrics.snapshotDate);

  return {
    ...ad,
    latestViews: ad.latestViews == null ? null : Number(ad.latestViews),
    metrics: metrics.map((m) => ({
      date: m.date,
      views: m.views == null ? null : Number(m.views),
      likes: m.likes,
    })),
  };
}

export interface CompetitorRow {
  id: string;
  name: string;
  advertiserId: string;
  domain: string | null;
  region: string;
  isActive: boolean;
  adCount: number;
}

/** 경쟁사 관리 — 전체 목록 + 경쟁사별 수집 광고 수 */
export async function listCompetitors(): Promise<CompetitorRow[]> {
  const rows = await db()
    .select({
      id: competitors.id,
      name: competitors.name,
      advertiserId: competitors.advertiserId,
      domain: competitors.domain,
      region: competitors.region,
      isActive: competitors.isActive,
      // 상관 컬럼은 리터럴(competitors.id)로 명시 — Drizzle 의 ${} 한정자 누락 버그 회피
      adCount: sql<number>`(SELECT count(*) FROM ads sub WHERE sub.competitor_id = competitors.id)`,
    })
    .from(competitors)
    .orderBy(desc(competitors.createdAt));

  return rows.map((r) => ({ ...r, adCount: Number(r.adCount) }));
}

export interface RunRow {
  id: string;
  kind: string;
  status: string;
  newAdsCount: number;
  apiCallCount: number;
  startedAt: Date;
  errorMessage: string | null;
}

/** 수집 현황 — 최근 실행 이력 */
export async function recentRuns(limit = 30): Promise<RunRow[]> {
  return db()
    .select({
      id: collectionRuns.id,
      kind: collectionRuns.kind,
      status: collectionRuns.status,
      newAdsCount: collectionRuns.newAdsCount,
      apiCallCount: collectionRuns.apiCallCount,
      startedAt: collectionRuns.startedAt,
      errorMessage: collectionRuns.errorMessage,
    })
    .from(collectionRuns)
    .orderBy(desc(collectionRuns.startedAt))
    .limit(limit);
}
