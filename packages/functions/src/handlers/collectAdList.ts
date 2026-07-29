import { isFormatAllowed, type NewAdQueueMessage } from '@adref/core';
import type { HandlerDeps } from './context.js';

export interface CollectAdListResult {
  status: 'success' | 'partial' | 'failed';
  newAds: number;
  apiCalls: number;
  throttled: boolean;
}

/**
 * 광고 목록 수집기 (순수 핸들러).
 * 활성 경쟁사별로 SerpApi 목록을 조회 → creative_id 로 신규 감지 → 큐 적재.
 * 쿼터 임계치 도달 시 이후 경쟁사는 건너뛰고 status='partial'.
 */
export async function collectAdList(deps: HandlerDeps): Promise<CollectAdListResult> {
  const { ads, queue, repos, quota, env } = deps;
  const run = await repos.runs.start('list');

  let newAds = 0;
  let apiCalls = 0;
  let throttled = false;

  try {
    const competitors = await repos.competitors.listActive();

    for (const competitor of competitors) {
      if (!quota.canCall()) {
        throttled = true;
        break;
      }

      const { items, apiCalls: calls } = await ads.listAds({
        advertiserId: competitor.advertiserId,
        region: competitor.region,
      });
      apiCalls += calls;
      quota.record(calls);

      // 스코프: COLLECT_FORMATS 에 따라 비디오만(기본) 또는 전체(all) 수집
      const scoped = items.filter((i) => isFormatAllowed(i.format, env.COLLECT_FORMATS));
      const existing = await repos.ads.existingCreativeIds(scoped.map((i) => i.creativeId));
      const fresh = scoped.filter((i) => !existing.has(i.creativeId));

      for (const item of fresh) {
        const msg: NewAdQueueMessage = {
          competitorId: competitor.id,
          advertiserId: competitor.advertiserId,
          creativeId: item.creativeId,
          format: item.format,
          firstShown: item.firstShown,
          lastShown: item.lastShown,
          daysShown: item.daysShown,
        };
        await queue.enqueue(env.AD_QUEUE_NAME, msg);
        newAds += 1;
      }
    }

    const status = throttled ? 'partial' : 'success';
    await repos.runs.finish(run.id, { status, newAdsCount: newAds, apiCallCount: apiCalls });
    return { status, newAds, apiCalls, throttled };
  } catch (err) {
    await repos.runs.finish(run.id, {
      status: 'failed',
      newAdsCount: newAds,
      apiCallCount: apiCalls,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
