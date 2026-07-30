/**
 * 일회성 백필 — 구버전 수집분(이미지·텍스트, raw 없음)의 광고 구성요소를 서버 크롤로 재수집한다.
 * 목록을 거치지 않고 DB 의 creative_id 로 상세만 직접 요청 → 게재 종료로 목록에서 내려간
 * 광고도 보강되고 요청 수도 최소화된다 (광고당 RPC 1 + 미리보기 fetch ≤3).
 *
 * 실행: CRAWL_THROTTLE_MS=1200 pnpm tsx scripts/recollect-components.mts [--limit N]
 * 차단(/sorry) 감지 시 즉시 중단한다 — 차단 중 재시도는 차단을 연장시킨다(CLAUDE.md).
 */
import 'dotenv/config';
import { createDb, landingDomain, loadEnv, TransparencyCrawlAdsSource } from '@adref/core';

const limitArg = process.argv.indexOf('--limit');
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 0;

const env = loadEnv();
const { pool } = createDb(env.DATABASE_URL);
const src = new TransparencyCrawlAdsSource();

async function main() {
  const { rows } = await pool.query<{ id: string; creativeId: string; advertiserId: string }>(
    `select a.id, a.creative_id as "creativeId", c.advertiser_id as "advertiserId"
     from ads a join competitors c on c.id = a.competitor_id
     where a.format in ('image','text') and a.raw is null
     order by a.collected_at desc
     ${limit ? `limit ${Math.floor(limit)}` : ''}`,
  );

  console.log(`재수집 대상 ${rows.length}건`);
  let ok = 0;
  let filled = 0;
  let failed = 0;

  for (const [i, r] of rows.entries()) {
    try {
      const { detail } = await src.getAdDetail({ advertiserId: r.advertiserId, creativeId: r.creativeId });
      await pool.query(
        `update ads set
           image_url = coalesce($1, image_url),
           headline = coalesce($2, headline),
           description = coalesce($3, description),
           cta_text = coalesce($4, cta_text),
           logo_url = coalesce($5, logo_url),
           landing_url = coalesce($6, landing_url),
           landing_domain = coalesce($7, landing_domain),
           raw = $8::jsonb,
           collected_at = now()
         where id = $9`,
        [
          detail.imageUrl ?? null,
          detail.headline ?? null,
          detail.description ?? null,
          detail.ctaText ?? null,
          detail.logoUrl ?? null,
          detail.landingUrl ?? null,
          landingDomain(detail.landingUrl) ?? null,
          JSON.stringify(detail.raw),
          r.id,
        ],
      );
      ok += 1;
      if (detail.headline || detail.description) filled += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 파싱 실패 = 차단(/sorry HTML 302) 신호 → 즉시 전체 중단 (차단 연장 방지)
      if (/파싱 실패/.test(msg)) {
        console.error(`[${i + 1}] ${r.creativeId}: 차단 감지 — 전체 중단. (${msg})`);
        break;
      }
      failed += 1;
      console.error(`[${i + 1}] ${r.creativeId}: ${msg}`);
    }
    if ((i + 1) % 10 === 0) console.log(`진행 ${i + 1}/${rows.length} (문구 확보 ${filled})`);
  }

  console.log(`완료: 성공 ${ok}, 문구 확보 ${filled}, 실패 ${failed}`);
}

main().finally(() => pool.end());
