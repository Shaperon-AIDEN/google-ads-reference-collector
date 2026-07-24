import type { HandlerDeps } from './context.js';

export interface CollectViewCountsResult {
  status: 'success' | 'partial' | 'failed';
  snapshots: number;
  apiCalls: number;
  throttled: boolean;
}

/** UTC 기준 오늘 날짜 (YYYY-MM-DD) */
function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * 조회수 수집기 (순수 핸들러). youtube_video_id 보유 광고 전체를 배치 조회해
 * ad_metrics 에 일별 스냅샷으로 적재한다. (ad_id, snapshot_date) 중복은 무시.
 */
export async function collectViewCounts(
  deps: HandlerDeps,
  now: Date = new Date(),
): Promise<CollectViewCountsResult> {
  const { youtube, repos, quota } = deps;
  const run = await repos.runs.start('view_count');
  const snapshotDate = today(now);

  let snapshots = 0;
  let apiCalls = 0;
  let throttled = false;

  try {
    if (!quota.canCall()) {
      await repos.runs.finish(run.id, { status: 'partial', apiCallCount: 0 });
      return { status: 'partial', snapshots: 0, apiCalls: 0, throttled: true };
    }

    const targets = await repos.ads.withYouTubeId();
    const byVideoId = new Map<string, string>(); // videoId → adId
    for (const t of targets) {
      if (t.youtubeVideoId) byVideoId.set(t.youtubeVideoId, t.id);
    }

    const ids = [...byVideoId.keys()];
    if (ids.length > 0) {
      const { stats, apiCalls: calls } = await youtube.getVideoStats(ids);
      apiCalls += calls;
      quota.record(calls);

      for (const s of stats) {
        const adId = byVideoId.get(s.videoId);
        if (!adId) continue;
        await repos.adMetrics.insertSnapshot({
          adId,
          snapshotDate,
          ytViewCount: s.viewCount,
          ytLikeCount: s.likeCount,
        });
        snapshots += 1;
      }
    }

    const status = throttled ? 'partial' : 'success';
    await repos.runs.finish(run.id, { status, apiCallCount: apiCalls });
    return { status, snapshots, apiCalls, throttled };
  } catch (err) {
    await repos.runs.finish(run.id, {
      status: 'failed',
      apiCallCount: apiCalls,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
