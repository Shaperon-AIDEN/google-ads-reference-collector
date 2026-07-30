import { landingDomain, parseYouTubeId, type NewAdQueueMessage } from '@adref/core';
import type { HandlerDeps } from './context.js';

/** first/last 게재일로 총 게재일수 계산 (양끝 포함) — 목록이 total_days_shown 을 안 줄 때 폴백 */
function daysBetween(first?: string, last?: string): number | null {
  if (!first || !last) return null;
  const a = Date.parse(first);
  const b = Date.parse(last);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000)) + 1;
}

/** 영상 URL / creativeId 에서 YouTube 썸네일 원본 URL 유도 */
function youtubeThumbUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * 상세 수집기 (순수 핸들러). 큐 메시지 1건을 처리한다.
 * SerpApi 상세 조회 → YouTube video ID 파싱 → 썸네일 Blob 저장 → creative_id upsert.
 * 예외를 던지면 Queue Trigger 가 재시도(최대 5회) 후 포이즌 큐로 이동시킨다.
 */
export async function collectAdDetail(deps: HandlerDeps, msg: NewAdQueueMessage): Promise<void> {
  const { ads, blob, repos, quota, env } = deps;

  if (!quota.canCall()) {
    // 쿼터 소진: 다음 주기에 재수집되도록 예외로 반환(재시도 대상)
    throw new Error('쿼터 임계치 도달 — 상세 수집 보류');
  }

  const { detail, apiCalls } = await ads.getAdDetail({
    advertiserId: msg.advertiserId,
    creativeId: msg.creativeId,
  });
  quota.record(apiCalls);

  const youtubeVideoId = parseYouTubeId(detail.videoUrl);

  // 썸네일: YouTube 영상이면 hqdefault 를 Blob 에 캐시
  let thumbnailPath: string | undefined;
  if (youtubeVideoId) {
    try {
      const res = await fetch(youtubeThumbUrl(youtubeVideoId));
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const path = `${msg.creativeId}.jpg`;
        const saved = await blob.put(env.BLOB_CONTAINER, path, buf, 'image/jpeg');
        thumbnailPath = saved.path;
      }
    } catch {
      // 썸네일 실패는 광고 저장을 막지 않는다 (베스트 에포트)
    }
  }

  // 조회수·좋아요·게시일을 upsert 전에 확보 (게시일을 광고 행에 저장하기 위함).
  // YouTube API 는 무료(별도 쿼터)라 SerpApi/크롤 쿼터와 무관. 실패는 무시.
  let stats: { viewCount?: bigint; likeCount?: number; publishedAt?: string } | undefined;
  if (youtubeVideoId) {
    try {
      const res = await deps.youtube.getVideoStats([youtubeVideoId]);
      stats = res.stats[0];
    } catch {
      // 통계 실패는 광고 저장을 막지 않는다 (일별 Timer 가 이후 보완)
    }
  }

  // 목록 스냅샷(format/게재일/게재일수)은 msg 에서, 영상·랜딩은 detail 에서 병합.
  const saved = await repos.ads.upsertByCreativeId({
    competitorId: msg.competitorId,
    creativeId: msg.creativeId,
    format: msg.format,
    platforms: [],
    firstShown: msg.firstShown,
    lastShown: msg.lastShown,
    daysShown: msg.daysShown ?? daysBetween(msg.firstShown, msg.lastShown),
    videoUrl: detail.videoUrl,
    youtubeVideoId,
    publishedAt: stats?.publishedAt ? new Date(stats.publishedAt) : null,
    imageUrl: detail.imageUrl,
    headline: detail.headline,
    description: detail.description,
    ctaText: detail.ctaText,
    logoUrl: detail.logoUrl,
    thumbnailPath,
    landingUrl: detail.landingUrl,
    landingDomain: landingDomain(detail.landingUrl),
    regions: null,
    raw: detail.raw,
    collectedAt: new Date(),
  });

  // 수집 시점에 조회수 스냅샷도 즉시 적재 (일별 Timer 를 기다리지 않고 즉시 표시).
  if (stats) {
    await repos.adMetrics.insertSnapshot({
      adId: saved.id,
      snapshotDate: new Date().toISOString().slice(0, 10),
      ytViewCount: stats.viewCount,
      ytLikeCount: stats.likeCount,
    });
  }
}
