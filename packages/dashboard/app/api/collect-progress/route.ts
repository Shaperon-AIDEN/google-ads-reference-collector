import { createQueueClient, schema } from '@adref/core';
import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * 수집 진행상황 — "지금 수집" 후 폴링용.
 * 큐 잔량(목록 이어달리기·상세 대기)·크롤 페이싱(500건 휴식)·최근 목록 실행을 반환한다.
 */
export async function GET() {
  const e = env();

  // 큐 잔량 (수집기와 같은 Storage 계정을 봐야 함 — AzureWebJobsStorage 설정 필요)
  let listQueue = 0;
  let detailQueue = 0;
  try {
    const q = createQueueClient(e);
    [listQueue, detailQueue] = await Promise.all([
      q.approximateCount(e.COLLECT_QUEUE_NAME),
      q.approximateCount(e.AD_QUEUE_NAME),
    ]);
  } catch {
    // 큐 조회 실패(설정 없음 등)는 무시 — 나머지 지표만 표시
  }

  const pacingRows = await db().select().from(schema.crawlPacing).where(eq(schema.crawlPacing.id, 1)).limit(1);
  const pacing = pacingRows[0] ?? null;

  const lastRun = await db()
    .select({
      status: schema.collectionRuns.status,
      newAds: schema.collectionRuns.newAdsCount,
      startedAt: schema.collectionRuns.startedAt,
      finishedAt: schema.collectionRuns.finishedAt,
    })
    .from(schema.collectionRuns)
    .where(eq(schema.collectionRuns.kind, 'list'))
    .orderBy(desc(schema.collectionRuns.startedAt))
    .limit(1);

  return NextResponse.json({
    listQueue, // 목록 이어달리기 대기
    detailQueue, // 상세 수집 대기 (남은 광고 수)
    windowCount: pacing?.windowCount ?? 0, // 이번 500건 구간 진행
    pauseUntil: pacing?.pauseUntil && new Date(pacing.pauseUntil).getTime() > Date.now() ? pacing.pauseUntil : null,
    lastListRun: lastRun[0] ?? null,
  });
}
