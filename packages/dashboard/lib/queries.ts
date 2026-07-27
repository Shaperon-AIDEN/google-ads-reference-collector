import { schema } from '@adref/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from './db';

const { ads, adMetrics, competitors, collectionRuns } = schema;

export type AdSort = 'newest' | 'views' | 'likes' | 'duration';

export interface AdListFilter {
  competitorId?: string;
  format?: 'video' | 'image' | 'text';
  sort?: AdSort;
  minViews?: number; // 최신 조회수 하한
  from?: string; // 게재 기간 시작(YYYY-MM-DD) — 이 날짜에도 게재 중이던 광고까지 포함(겹침)
  to?: string; // 게재 기간 종료(YYYY-MM-DD)
}

/** 게재 기간이 [from, to] 와 겹치는 광고 조건. null 게재일은 열린 구간으로 취급(관대). */
function periodOverlapConds(from?: string, to?: string) {
  const conds = [];
  // 시작이 to 이전(또는 미상)이어야 하고, 종료가 from 이후(또는 미상)여야 겹친다.
  if (to) conds.push(sql`(${ads.firstShown} IS NULL OR ${ads.firstShown} <= ${to})`);
  if (from) conds.push(sql`(${ads.lastShown} IS NULL OR ${ads.lastShown} >= ${from})`);
  return conds;
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
  latestLikes: number | null;
}

// 각 광고의 최신 조회수 스냅샷 서브쿼리.
// ⚠️ Drizzle 의 ${ads.id} 는 한정자 없이 "id" 로 렌더돼 서브쿼리 내 다른 테이블(ad_metrics.id)에
//    바인딩되는 버그가 있어, 상관 컬럼은 리터럴 SQL(ads.id)로 명시한다.
const latestViewsSql = sql<number>`(
  SELECT m.yt_view_count FROM ad_metrics m
  WHERE m.ad_id = ads.id
  ORDER BY m.snapshot_date DESC LIMIT 1
)`;

// 최신 좋아요 스냅샷 (좋아요 값이 있는 마지막 스냅샷 — 비공개 영상은 NULL 일 수 있음)
const latestLikesSql = sql<number>`(
  SELECT m.yt_like_count FROM ad_metrics m
  WHERE m.ad_id = ads.id AND m.yt_like_count IS NOT NULL
  ORDER BY m.snapshot_date DESC LIMIT 1
)`;

/** 레퍼런스 리스트 (메인) — 경쟁사명 조인 + 최신 조회수, 정렬·필터 */
export async function listAds(filter: AdListFilter = {}): Promise<AdCard[]> {
  // 조회수가 확인되지 않는 영상(비-YouTube·비공개·삭제·미스냅샷)은 목록에서 숨긴다.
  // (데이터는 보존 — 이후 조회수가 잡히면 자동으로 다시 노출)
  const conds = [sql`${latestViewsSql} IS NOT NULL`];
  if (filter.competitorId) conds.push(eq(ads.competitorId, filter.competitorId));
  if (filter.format) conds.push(eq(ads.format, filter.format));
  if (filter.minViews && filter.minViews > 0) {
    conds.push(sql`${latestViewsSql} >= ${filter.minViews}`);
  }
  conds.push(...periodOverlapConds(filter.from, filter.to));

  // 최신순 = 영상 게시일(publishedAt) 기준. 없으면 게재 시작일 → 수집 시각 폴백.
  const recencySql = sql`coalesce(${ads.publishedAt}, ${ads.firstShown}::timestamptz, ${ads.collectedAt})`;
  const order =
    filter.sort === 'views'
      ? desc(latestViewsSql)
      : filter.sort === 'likes'
        ? desc(latestLikesSql)
        : filter.sort === 'duration'
          ? desc(ads.daysShown)
          : desc(recencySql);

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
      latestLikes: latestLikesSql,
    })
    .from(ads)
    .innerJoin(competitors, eq(competitors.id, ads.competitorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(order)
    .limit(500);

  return rows.map((r) => ({
    ...r,
    latestViews: r.latestViews == null ? null : Number(r.latestViews),
    latestLikes: r.latestLikes == null ? null : Number(r.latestLikes),
  }));
}

export type BestPeriod = 'day' | 'week' | 'month';
const PERIOD_DAYS: Record<BestPeriod, number> = { day: 1, week: 7, month: 30 };

export interface BestAd extends AdCard {
  growth: number | null; // 기간 내 조회수 증가량
}

/**
 * 일간/주간/월간 베스트 — 기간 내 조회수 증가량(growth) 순위.
 * growth = 최신 스냅샷 조회수 − (기간 시작 이전 마지막 스냅샷, 없으면 최초 스냅샷) 조회수.
 * 스냅샷 이력이 부족하면 growth≈0 이 되어 총 조회수(latestViews) 순으로 자연 폴백된다.
 * 이력이 쌓일수록 진짜 "급상승" 순위가 된다.
 */
export async function bestAds(period: BestPeriod, minViews = 0, from?: string, to?: string): Promise<BestAd[]> {
  const days = PERIOD_DAYS[period];
  // 상관 서브쿼리 컬럼은 리터럴 ads.id 로 (Drizzle ${} 한정자 누락 버그 회피)
  const growthSql = sql<number>`(
    (SELECT m.yt_view_count FROM ad_metrics m WHERE m.ad_id = ads.id ORDER BY m.snapshot_date DESC LIMIT 1)
    - COALESCE(
        (SELECT m.yt_view_count FROM ad_metrics m WHERE m.ad_id = ads.id AND m.snapshot_date <= (CURRENT_DATE - ${days}::int) ORDER BY m.snapshot_date DESC LIMIT 1),
        (SELECT m.yt_view_count FROM ad_metrics m WHERE m.ad_id = ads.id ORDER BY m.snapshot_date ASC LIMIT 1)
      )
  )`;

  const conds = [sql`${latestViewsSql} IS NOT NULL`];
  if (minViews > 0) conds.push(sql`${latestViewsSql} >= ${minViews}`);
  conds.push(...periodOverlapConds(from, to));

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
      latestLikes: latestLikesSql,
      growth: growthSql,
    })
    .from(ads)
    .innerJoin(competitors, eq(competitors.id, ads.competitorId))
    .where(and(...conds))
    .orderBy(desc(growthSql), desc(latestViewsSql))
    .limit(100);

  return rows.map((r) => ({
    ...r,
    latestViews: r.latestViews == null ? null : Number(r.latestViews),
    latestLikes: r.latestLikes == null ? null : Number(r.latestLikes),
    growth: r.growth == null ? null : Number(r.growth),
  }));
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
      latestLikes: latestLikesSql,
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
    latestLikes: ad.latestLikes == null ? null : Number(ad.latestLikes),
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
