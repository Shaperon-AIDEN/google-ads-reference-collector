import { isFormatAllowed, type AdListItem, type NewAdQueueMessage } from '@adref/core';
import type { HandlerDeps } from './context.js';
import { collectAdDetail } from './collectAdDetail.js';

export interface CollectForCompetitorResult {
  status: 'success' | 'partial' | 'failed';
  competitor: string;
  newAds: number;
  processedInline: number;
  enqueued: number;
  apiCalls: number;
  throttled: boolean;
}

/**
 * 단일 경쟁사 온디맨드 수집 ("지금 수집").
 * 목록 조회 → 신규 감지 후, 즉시 결과를 보이도록 앞의 maxInline 건은 상세를 인라인 처리하고
 * 나머지는 큐에 적재해 백그라운드(Queue Trigger)가 이어받는다.
 */
export async function collectForCompetitor(
  deps: HandlerDeps,
  competitorId: string,
  opts: { maxInline?: number; maxTotal?: number } = {},
): Promise<CollectForCompetitorResult> {
  const { ads, queue, repos, quota, env } = deps;
  const maxInline = opts.maxInline ?? 8;
  // 쿼터 보호 상한 — 초과분은 이번 실행에서 처리하지 않는다 (대형 광고주 폭주 방지)
  const maxTotal = opts.maxTotal ?? Infinity;
  const run = await repos.runs.start('list');

  let apiCalls = 0;
  let processedInline = 0;
  let enqueued = 0;
  let throttled = false;

  try {
    const competitor = await repos.competitors.findById(competitorId);
    if (!competitor) throw new Error(`경쟁사를 찾을 수 없습니다: ${competitorId}`);

    if (!quota.canCall()) {
      await repos.runs.finish(run.id, { status: 'partial', apiCallCount: 0 });
      return {
        status: 'partial',
        competitor: competitor.name,
        newAds: 0,
        processedInline: 0,
        enqueued: 0,
        apiCalls: 0,
        throttled: true,
      };
    }

    // 페이지네이션으로 신규 비디오 광고를 maxTotal 만큼 모은다 (전체 수집 지원).
    // 크롤 소스는 apiCalls=0(무료)이라 페이지를 많이 넘겨도 쿼터 무관.
    const MAX_PAGES = 300; // 안전 상한 (40건/페이지 × 300 = 12,000건까지 스크롤)
    const fresh: AdListItem[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (!quota.canCall()) {
        throttled = true;
        break;
      }
      const { items, nextPageToken, apiCalls: listCalls } = await ads.listAds({
        advertiserId: competitor.advertiserId,
        region: competitor.region,
        pageToken,
      });
      apiCalls += listCalls;
      quota.record(listCalls);

      // 스코프: COLLECT_FORMATS 에 따라 비디오만(기본) 또는 전체(all)
      const scoped = items.filter((i) => isFormatAllowed(i.format, env.COLLECT_FORMATS));
      const existing = await repos.ads.existingCreativeIds(scoped.map((i) => i.creativeId));
      for (const it of scoped) if (!existing.has(it.creativeId)) fresh.push(it);

      if (fresh.length >= maxTotal || !nextPageToken) break;
      pageToken = nextPageToken;
    }
    // 상한 적용
    fresh.length = Math.min(fresh.length, maxTotal);

    for (let i = 0; i < fresh.length; i++) {
      const item = fresh[i]!;
      const msg: NewAdQueueMessage = {
        competitorId: competitor.id,
        advertiserId: competitor.advertiserId,
        creativeId: item.creativeId,
        format: item.format,
        firstShown: item.firstShown,
        lastShown: item.lastShown,
        daysShown: item.daysShown,
      };
      // 앞의 maxInline 건은 즉시 상세 처리(쿼터 여유 시), 나머지는 큐로
      if (i < maxInline && quota.canCall()) {
        try {
          await collectAdDetail(deps, msg);
          apiCalls += 1; // getAdDetail 1회
          processedInline += 1;
        } catch {
          // 인라인 실패 시 큐로 넘겨 재시도되게 함
          await queue.enqueue(env.AD_QUEUE_NAME, msg);
          enqueued += 1;
        }
      } else {
        await queue.enqueue(env.AD_QUEUE_NAME, msg);
        enqueued += 1;
      }
    }

    if (!quota.canCall() && enqueued > 0) throttled = true;
    const status = throttled ? 'partial' : 'success';
    await repos.runs.finish(run.id, {
      status,
      newAdsCount: fresh.length,
      apiCallCount: apiCalls,
    });

    return {
      status,
      competitor: competitor.name,
      newAds: fresh.length,
      processedInline,
      enqueued,
      apiCalls,
      throttled,
    };
  } catch (err) {
    await repos.runs.finish(run.id, {
      status: 'failed',
      apiCallCount: apiCalls,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
