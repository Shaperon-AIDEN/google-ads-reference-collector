import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { buildDeps } from '../handlers/context.js';
import { collectForCompetitor } from '../handlers/collectForCompetitor.js';

/**
 * 온디맨드 수집 HTTP 트리거 — 대시보드 "지금 수집" 버튼이 호출.
 * POST /api/collectForCompetitor  { competitorId }
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

  const deps = await buildDeps();
  try {
    const result = await collectForCompetitor(deps, body.competitorId, {
      maxTotal: typeof body.maxTotal === 'number' ? body.maxTotal : undefined,
    });
    context.log(`[collectForCompetitor] ${result.competitor} new=${result.newAds} inline=${result.processedInline}`);
    return { status: 200, jsonBody: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 502, jsonBody: { error: message } };
  } finally {
    await deps.close();
  }
}

app.http('collectForCompetitor', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'collectForCompetitor',
  handler: collectForCompetitorHttp,
});
