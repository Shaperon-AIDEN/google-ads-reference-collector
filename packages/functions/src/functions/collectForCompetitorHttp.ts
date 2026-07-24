import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { createQueueClient, loadEnv, type CollectRequestMessage } from '@adref/core';

/**
 * 온디맨드 수집 트리거 (HTTP) — 대시보드 "지금 수집" 버튼이 호출.
 * 실제 수집은 시간이 걸리므로 여기서는 **큐에 요청만 적재하고 즉시 반환**한다.
 * 백그라운드의 collectRequestProcessor(Queue Trigger)가 이어받아 처리하므로,
 * 사용자가 페이지를 벗어나도 수집은 완료된다.
 * POST /api/collectForCompetitor  { competitorId, maxTotal? }
 */
export async function collectForCompetitorHttp(
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  let body: { competitorId?: string; maxTotal?: number };
  try {
    body = (await req.json()) as { competitorId?: string; maxTotal?: number };
  } catch {
    return { status: 400, jsonBody: { error: '잘못된 요청' } };
  }
  if (!body.competitorId) {
    return { status: 400, jsonBody: { error: 'competitorId 필요' } };
  }

  const env = loadEnv();
  const queue = createQueueClient(env);
  const msg: CollectRequestMessage = {
    competitorId: body.competitorId,
    // 한 번의 "지금 수집"은 기본 100건까지 (무제한 방지 — 반복 클릭으로 더 수집).
    // SerpApi 롤백 시 쿼터 폭주도 예방.
    maxTotal: typeof body.maxTotal === 'number' ? body.maxTotal : 100,
  };
  await queue.enqueue(env.COLLECT_QUEUE_NAME, msg);
  context.log(`[collectForCompetitor] queued competitorId=${msg.competitorId}`);
  return { status: 202, jsonBody: { queued: true } };
}

app.http('collectForCompetitor', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'collectForCompetitor',
  handler: collectForCompetitorHttp,
});
