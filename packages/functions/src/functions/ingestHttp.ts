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
      `[ingest] ${result.competitor}: 수신 ${result.received}, 저장 ${result.saved}, 건너뜀 ${result.skipped}, 스냅샷 ${result.snapshots}`,
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

/**
 * 스크린샷 대상 목록 — 이미지·텍스트 광고 중 대안 스크린샷이 하나도 없는 것.
 * GET /api/screenshot/targets → { targets: [{ creativeId, advertiserId }] }
 */
export async function screenshotTargetsHttp(req: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS };
  const deps = await buildDeps();
  try {
    const { rows } = await deps.pool.query<{ creativeId: string; advertiserId: string }>(
      `select a.creative_id as "creativeId", c.advertiser_id as "advertiserId"
       from ads a join competitors c on c.id = a.competitor_id
       where a.format in ('image','text')
         and not exists (select 1 from ad_variations v where v.ad_id = a.id and v.screenshot is not null)
       order by a.collected_at desc
       limit 300`,
    );
    return { status: 200, headers: CORS, jsonBody: { targets: rows } };
  } finally {
    await deps.close();
  }
}

app.http('screenshotTargets', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'screenshot/targets',
  handler: screenshotTargetsHttp,
});

/**
 * 대안별 스크린샷 저장 — 확장이 투명성 센터 렌더링을 캡처해 보낸 PNG(dataUrl)를 bytea 로 보존.
 * POST /api/screenshot  { creativeId, shots: [{ idx, width?, height?, dataUrl }] }
 */
export async function screenshotHttp(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS };

  let body: { creativeId?: string; shots?: Array<{ idx: number; width?: number; height?: number; dataUrl: string }> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return { status: 400, headers: CORS, jsonBody: { error: '잘못된 JSON' } };
  }
  if (!body?.creativeId || !Array.isArray(body.shots) || body.shots.length === 0) {
    return { status: 400, headers: CORS, jsonBody: { error: 'creativeId 와 shots[] 가 필요합니다' } };
  }

  const deps = await buildDeps();
  try {
    const { rows } = await deps.pool.query<{ id: string }>('select id from ads where creative_id = $1', [
      body.creativeId,
    ]);
    const ad = rows[0];
    if (!ad) return { status: 404, headers: CORS, jsonBody: { error: '해당 creative_id 광고 없음' } };

    let saved = 0;
    for (const s of body.shots) {
      const m = /^data:image\/png;base64,(.+)$/.exec(s.dataUrl ?? '');
      if (!m || !Number.isInteger(s.idx)) continue;
      const png = Buffer.from(m[1]!, 'base64');
      if (png.length === 0 || png.length > 8 * 1024 * 1024) continue; // 빈/비정상 크기 거부
      await deps.repos.adVariations.saveScreenshot(ad.id, s.idx, png, { width: s.width, height: s.height });
      saved += 1;
    }
    context.log(`[screenshot] ${body.creativeId}: ${saved}/${body.shots.length}건 저장`);
    return { status: 200, headers: CORS, jsonBody: { saved } };
  } finally {
    await deps.close();
  }
}

app.http('screenshot', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'screenshot',
  handler: screenshotHttp,
});
