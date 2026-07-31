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
 * 크롤 페이싱 게이트 — 상세 수집을 CRAWL_RUN_LIMIT(기본 500)건 단위로 끊고, 한도에 닿으면
 * CRAWL_RUN_PAUSE_MS(기본 10분) 휴식한다 (502건 연속 수집 시 봇 차단 실측).
 * 반환값 > 0 이면 "휴식 중" — 호출부가 메시지를 그 시간만큼 지연 재적재하고 처리를 건너뛴다.
 * 상태는 DB 싱글턴 행(crawl_pacing)이라 Functions 재시작·다중 인스턴스에도 유지된다.
 */
async function crawlPacingGate(deps: HandlerDeps): Promise<number> {
  const { pool, env } = deps;
  const limit = env.CRAWL_RUN_LIMIT;
  const { rows } = await pool.query<{ window_count: number; pause_until: Date | null }>(
    'select window_count, pause_until from crawl_pacing where id = 1',
  );
  let count = rows[0]?.window_count ?? 0;
  const pauseUntil = rows[0]?.pause_until ? new Date(rows[0].pause_until).getTime() : null;
  const now = Date.now();

  if (pauseUntil && now < pauseUntil) return pauseUntil - now; // 휴식 중 → 지연 재적재
  if (pauseUntil) count = 0; // 휴식 종료 → 새 윈도우

  count += 1;
  // 이 건이 한도의 마지막이면 지금부터 휴식 시작 (이 건 자체는 처리)
  const newPause = count >= limit ? new Date(now + env.CRAWL_RUN_PAUSE_MS) : null;
  await pool.query(
    `insert into crawl_pacing (id, window_count, pause_until) values (1, $1, $2)
     on conflict (id) do update set window_count = $1, pause_until = $2`,
    [count >= limit ? 0 : count, newPause],
  );
  return 0;
}

/**
 * 상세 수집기 (순수 핸들러). 큐 메시지 1건을 처리한다.
 * SerpApi 상세 조회 → YouTube video ID 파싱 → 썸네일 Blob 저장 → creative_id upsert.
 * 예외를 던지면 Queue Trigger 가 재시도(최대 5회) 후 포이즌 큐로 이동시킨다.
 */
export async function collectAdDetail(deps: HandlerDeps, msg: NewAdQueueMessage): Promise<void> {
  const { ads, blob, repos, quota, env } = deps;

  // 크롤 페이싱 — 500건 단위로 끊고 10분 휴식 (휴식 중 메시지는 지연 재적재 후 자동 재개)
  if (env.ADS_SOURCE === 'crawl' && env.CRAWL_RUN_LIMIT > 0) {
    const deferMs = await crawlPacingGate(deps);
    if (deferMs > 0) {
      await deps.queue.enqueue(env.AD_QUEUE_NAME, msg, { visibilityTimeoutMs: deferMs });
      return;
    }
  }

  if (!quota.canCall()) {
    // 쿼터 소진: 다음 주기에 재수집되도록 예외로 반환(재시도 대상)
    throw new Error('쿼터 임계치 도달 — 상세 수집 보류');
  }

  const { detail, apiCalls } = await ads.getAdDetail({
    advertiserId: msg.advertiserId,
    creativeId: msg.creativeId,
    format: msg.format, // 크롤 소스가 대안 수집 범위를 정함 (비디오=조기 중단, 이미지·텍스트=전체)
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

  // 대안(variation) 보존 — 대안마다 사이즈·문구·CTA 가 다르다 (ad_id, idx 멱등 upsert)
  for (const v of detail.variations ?? []) {
    await repos.adVariations.upsert({
      adId: saved.id,
      idx: v.idx,
      width: v.width ?? null,
      height: v.height ?? null,
      headline: v.headline ?? null,
      description: v.description ?? null,
      ctaText: v.ctaText ?? null,
      logoUrl: v.logoUrl ?? null,
      imageUrl: v.imageUrl ?? null,
      landingUrl: v.landingUrl ?? null,
    });
  }

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
