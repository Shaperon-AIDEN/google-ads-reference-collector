/**
 * 일회성 백필 — 이미 수집된 광고의 `raw`(GetCreativeById 응답)에 든 미리보기 URL 로
 * 구성요소·대안을 재추출한다. **RPC 를 다시 부르지 않으므로** 봇 차단(/sorry)과 무관하다
 * (미리보기는 googleusercontent CDN — 차단 대상 아님).
 *
 * 대상: 이미지·텍스트 광고 중 raw 는 있으나 문구가 비어 있는 것 (추출기 개선 전 수집분).
 * 실행: pnpm tsx scripts/backfill-from-raw.mts [--limit N]
 */
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createDb, landingDomain, loadEnv, TransparencyCrawlAdsSource, type AdFormat } from '@adref/core';

const execFileAsync = promisify(execFile);
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const limitArg = process.argv.indexOf('--limit');
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 0;

const env = loadEnv();
const { pool } = createDb(env.DATABASE_URL);

async function main() {
  const { rows } = await pool.query<{ id: string; creativeId: string; format: AdFormat; raw: unknown }>(
    `select id, creative_id as "creativeId", format, raw
     from ads
     where format in ('image','text') and raw is not null and headline is null and description is null
     order by collected_at desc
     ${limit ? `limit ${Math.floor(limit)}` : ''}`,
  );
  console.log(`백필 대상 ${rows.length}건 (raw 의 미리보기 URL 재추출 — RPC 미사용)`);

  let filled = 0;
  let empty = 0;
  let failed = 0;

  for (const [i, r] of rows.entries()) {
    try {
      // rpc 는 저장된 raw 를 그대로 반환(네트워크 없음), 미리보기만 실제 fetch
      const src = new TransparencyCrawlAdsSource({
        rpc: async () => JSON.stringify(r.raw),
        get: async (url) => {
          await new Promise((res) => setTimeout(res, 400 + Math.random() * 400));
          const { stdout } = await execFileAsync('curl', ['-s', '--max-time', '20', url, '-H', `user-agent: ${UA}`], {
            maxBuffer: 32 * 1024 * 1024,
          });
          return stdout;
        },
      });
      const { detail } = await src.getAdDetail({ advertiserId: 'AR0', creativeId: r.creativeId, format: r.format });

      await pool.query(
        `update ads set
           image_url = coalesce($1, image_url),
           headline = coalesce($2, headline),
           description = coalesce($3, description),
           cta_text = coalesce($4, cta_text),
           logo_url = coalesce($5, logo_url),
           landing_url = coalesce($6, landing_url),
           landing_domain = coalesce($7, landing_domain)
         where id = $8`,
        [
          detail.imageUrl ?? null,
          detail.headline ?? null,
          detail.description ?? null,
          detail.ctaText ?? null,
          detail.logoUrl ?? null,
          detail.landingUrl ?? null,
          landingDomain(detail.landingUrl) ?? null,
          r.id,
        ],
      );
      for (const v of detail.variations ?? []) {
        await pool.query(
          `insert into ad_variations (ad_id, idx, width, height, headline, description, cta_text, logo_url, image_url, landing_url)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           on conflict (ad_id, idx) do update set
             width = excluded.width, height = excluded.height, headline = excluded.headline,
             description = excluded.description, cta_text = excluded.cta_text, logo_url = excluded.logo_url,
             image_url = excluded.image_url, landing_url = excluded.landing_url, collected_at = now()`,
          [r.id, v.idx, v.width ?? null, v.height ?? null, v.headline ?? null, v.description ?? null, v.ctaText ?? null, v.logoUrl ?? null, v.imageUrl ?? null, v.landingUrl ?? null],
        );
      }
      if (detail.headline || detail.description) filled += 1;
      else empty += 1;
    } catch (e) {
      failed += 1;
      console.error(`[${i + 1}] ${r.creativeId}: ${e instanceof Error ? e.message : e}`);
    }
    if ((i + 1) % 10 === 0) console.log(`진행 ${i + 1}/${rows.length} (문구 확보 ${filled})`);
  }

  console.log(`완료: 문구 확보 ${filled}, 문구 없음 ${empty}, 실패 ${failed}`);
}

main().finally(() => pool.end());
