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
    // videoId → adId[] — 여러 광고가 같은 YouTube 영상을 공유할 수 있으므로 배열로 모은다.
    // (단일 Map 이면 영상당 광고 하나만 스냅샷돼 나머지가 누락됨)
    const byVideoId = new Map<string, string[]>();
    for (const t of targets) {
      if (!t.youtubeVideoId) continue;
      const arr = byVideoId.get(t.youtubeVideoId);
      if (arr) arr.push(t.id);
      else byVideoId.set(t.youtubeVideoId, [t.id]);
    }

    const ids = [...byVideoId.keys()];
    if (ids.length > 0) {
      const { stats, apiCalls: calls } = await youtube.getVideoStats(ids);
      apiCalls += calls;
      quota.record(calls);

      for (const s of stats) {
        const adIds = byVideoId.get(s.videoId) ?? [];
        for (const adId of adIds) {
          // 같은 영상을 쓰는 모든 광고에 스냅샷 적재
          await repos.adMetrics.insertSnapshot({
            adId,
            snapshotDate,
            ytViewCount: s.viewCount,
            ytLikeCount: s.likeCount,
          });
          snapshots += 1;
        }
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
