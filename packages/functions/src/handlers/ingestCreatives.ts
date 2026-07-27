import { landingDomain, parseYouTubeId } from '@adref/core';
import type { HandlerDeps } from './context.js';

/** Chrome 확장이 실제 브라우저에서 수집해 보낸 크리에이티브 1건 */
export interface IngestAd {
  creativeId: string;
  format: string; // 'video' | 'image' | 'text'
  firstShown?: string; // YYYY-MM-DD
  lastShown?: string;
  daysShown?: number | null;
  videoUrl?: string; // youtube embed/watch URL (있으면 여기서 video id 파싱)
  youtubeVideoId?: string; // 확장이 직접 파싱해 보낼 수도 있음
  landingUrl?: string;
  raw?: unknown;
}

export interface IngestPayload {
  advertiserId: string;
  ads: IngestAd[];
}

export interface IngestResult {
  status: 'success' | 'partial' | 'failed';
  competitor: string;
  received: number;
  savedVideo: number;
  skippedNonVideo: number;
  snapshots: number;
}

/** first/last 게재일로 총 게재일수 계산 (양끝 포함) */
function daysBetween(first?: string, last?: string): number | null {
  if (!first || !last) return null;
  const a = Date.parse(first);
  const b = Date.parse(last);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000)) + 1;
}

/**
 * Ingest 핸들러 (순수 DI). 실제 브라우저(Chrome 확장)가 투명성 센터에서 수집한
 * 비디오 크리에이티브를 받아 저장한다 — 서버가 직접 크롤하지 않으므로 /sorry 봇 차단을 회피.
 * 저장 계층은 collectAdDetail 과 동일: creative_id 멱등 upsert + YouTube 조회수/좋아요/게시일 스냅샷.
 * 스코프: 비디오 광고만 저장(이미지/텍스트는 건너뜀).
 */
export async function ingestCreatives(deps: HandlerDeps, payload: IngestPayload): Promise<IngestResult> {
  const { repos, youtube } = deps;
  const run = await repos.runs.start('detail');

  let savedVideo = 0;
  let skippedNonVideo = 0;
  let snapshots = 0;

  try {
    const competitor = await repos.competitors.findByAdvertiserId(payload.advertiserId);
    if (!competitor) throw new Error(`등록된 경쟁사를 찾을 수 없습니다 (advertiser_id=${payload.advertiserId})`);

    const videos = payload.ads.filter((a) => a.format === 'video');
    skippedNonVideo = payload.ads.length - videos.length;

    // 각 광고의 YouTube video id 확정 (payload 우선, 없으면 videoUrl 에서 파싱)
    const withVid = videos.map((a) => ({
      ad: a,
      youtubeVideoId: a.youtubeVideoId ?? parseYouTubeId(a.videoUrl) ?? undefined,
    }));

    // YouTube 통계 1회 배치 조회 (무료·별도 쿼터). 비-YouTube 는 스킵.
    const ids = [...new Set(withVid.map((w) => w.youtubeVideoId).filter((v): v is string => !!v))];
    const statsByVid = new Map<string, { viewCount?: bigint; likeCount?: number; publishedAt?: string }>();
    if (ids.length > 0) {
      try {
        const { stats } = await youtube.getVideoStats(ids);
        for (const s of stats) statsByVid.set(s.videoId, s);
      } catch {
        // 통계 실패는 저장을 막지 않는다 (일별 Timer 가 이후 보완)
      }
    }

    const snapshotDate = new Date().toISOString().slice(0, 10);
    for (const { ad, youtubeVideoId } of withVid) {
      if (!ad.creativeId) continue;
      const stats = youtubeVideoId ? statsByVid.get(youtubeVideoId) : undefined;

      const saved = await repos.ads.upsertByCreativeId({
        competitorId: competitor.id,
        creativeId: ad.creativeId,
        format: 'video',
        platforms: [],
        firstShown: ad.firstShown ?? null,
        lastShown: ad.lastShown ?? null,
        daysShown: ad.daysShown ?? daysBetween(ad.firstShown, ad.lastShown),
        videoUrl: ad.videoUrl ?? (youtubeVideoId ? `https://www.youtube.com/embed/${youtubeVideoId}` : null),
        youtubeVideoId: youtubeVideoId ?? null,
        publishedAt: stats?.publishedAt ? new Date(stats.publishedAt) : null,
        thumbnailPath: null, // 대시보드는 youtube_video_id 로 썸네일 URL 유도 (Blob 불필요)
        landingUrl: ad.landingUrl ?? null,
        landingDomain: landingDomain(ad.landingUrl),
        regions: null,
        raw: ad.raw ?? null,
        collectedAt: new Date(),
      });

      savedVideo += 1;
      if (stats) {
        await repos.adMetrics.insertSnapshot({
          adId: saved.id,
          snapshotDate,
          ytViewCount: stats.viewCount,
          ytLikeCount: stats.likeCount,
        });
        snapshots += 1;
      }
    }

    await repos.runs.finish(run.id, { status: 'success', newAdsCount: savedVideo, apiCallCount: 0 });
    return {
      status: 'success',
      competitor: competitor.name,
      received: payload.ads.length,
      savedVideo,
      skippedNonVideo,
      snapshots,
    };
  } catch (err) {
    await repos.runs.finish(run.id, {
      status: 'failed',
      apiCallCount: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
