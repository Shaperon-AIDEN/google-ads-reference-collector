import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { buildDeps } from '../handlers/context.js';
import { ingestCreatives, type IngestPayload } from '../handlers/ingestCreatives.js';

// Chrome 확장(chrome-extension://…)에서 POST 하므로 CORS 허용.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

/**
 * Ingest 엔드포인트 — Chrome 확장이 실제 브라우저에서 수집한 크리에이티브를 받아 저장한다.
 * 서버가 투명성 센터를 직접 크롤하지 않으므로 /sorry 봇 차단을 회피한다.
 * POST /api/ingest  { advertiserId, ads: [...] }
 */
export async function ingestHttp(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS };

  let body: IngestPayload;
  try {
    body = (await req.json()) as IngestPayload;
  } catch {
    return { status: 400, headers: CORS, jsonBody: { error: '잘못된 JSON' } };
  }
  if (!body?.advertiserId || !Array.isArray(body.ads)) {
    return { status: 400, headers: CORS, jsonBody: { error: 'advertiserId 와 ads[] 가 필요합니다' } };
  }

  const deps = await buildDeps();
  try {
    const result = await ingestCreatives(deps, body);
    context.log(
      `[ingest] ${result.competitor}: 수신 ${result.received}, 비디오 저장 ${result.savedVideo}, 스냅샷 ${result.snapshots}`,
    );
    return { status: 200, headers: CORS, jsonBody: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    context.error(`[ingest] 실패: ${message}`);
    return { status: 500, headers: CORS, jsonBody: { error: message } };
  } finally {
    await deps.close();
  }
}

app.http('ingest', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'ingest',
  handler: ingestHttp,
});

/**
 * 이미 저장된 creative_id 조회 — 확장이 신규만 상세 요청하도록(요청 수·차단 위험 최소화).
 * POST /api/known  { creativeIds: [...] } → { known: [...] }
 */
export async function knownHttp(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS };

  let body: { creativeIds?: string[] };
  try {
    body = (await req.json()) as { creativeIds?: string[] };
  } catch {
    return { status: 400, headers: CORS, jsonBody: { error: '잘못된 JSON' } };
  }
  const ids = Array.isArray(body?.creativeIds) ? body.creativeIds : [];

  const deps = await buildDeps();
  try {
    const known = await deps.repos.ads.existingCreativeIds(ids);
    context.log(`[known] 조회 ${ids.length}건 중 기존 ${known.size}건`);
    return { status: 200, headers: CORS, jsonBody: { known: [...known] } };
  } finally {
    await deps.close();
  }
}

app.http('known', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'known',
  handler: knownHttp,
});

/**
 * 등록된 경쟁사(advertiser) 목록 — 확장 팝업이 수집 대상을 선택하도록.
 * GET /api/advertisers → [{ advertiserId, name, region }]
 */
export async function advertisersHttp(req: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS };
  const deps = await buildDeps();
  try {
    const rows = await deps.repos.competitors.listAll();
    const list = rows.map((c) => ({ advertiserId: c.advertiserId, name: c.name, region: c.region }));
    return { status: 200, headers: CORS, jsonBody: { advertisers: list } };
  } finally {
    await deps.close();
  }
}

app.http('advertisers', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'advertisers',
  handler: advertisersHttp,
});
