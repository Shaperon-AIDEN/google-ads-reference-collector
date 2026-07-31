/**
 * 일회성 데이터 이관 — 로컬 PostgreSQL → Azure PostgreSQL.
 * 경쟁사 id 가 양쪽에서 다르므로 advertiser_id / creative_id 로 매핑한다.
 * 충돌(creative_id 기존재) 시 Azure 값을 우선하고 **빈 필드만** 로컬 값으로 채운다(비파괴).
 * 실행: LOCAL_DB=... AZURE_DB=... pnpm tsx scripts/migrate-data-to-azure.mts
 */
import { createDb } from '@adref/core';

const { pool: local } = createDb(process.env.LOCAL_DB!);
const { pool: azure } = createDb(process.env.AZURE_DB!);

async function main() {
  // 1) 경쟁사 매핑 (advertiser_id 기준) — Azure 에 없는 경쟁사는 생성
  const lc = await local.query('select id, name, advertiser_id, domain, region, is_active from competitors');
  const compMap = new Map<string, string>(); // local id → azure id
  for (const c of lc.rows) {
    const r = await azure.query(
      `insert into competitors (name, advertiser_id, domain, region, is_active)
       values ($1,$2,$3,$4,$5)
       on conflict (advertiser_id) do update set name = competitors.name
       returning id`,
      [c.name, c.advertiser_id, c.domain, c.region, c.is_active],
    );
    compMap.set(c.id, r.rows[0].id);
  }
  console.log(`경쟁사 매핑 ${compMap.size}건`);

  // 2) ads — creative_id upsert (충돌 시 빈 필드만 채움), 최종 id 매핑 확보
  const la = await local.query('select * from ads');
  const adMap = new Map<string, string>(); // local ad id → azure ad id
  let adsNew = 0;
  for (const a of la.rows) {
    const r = await azure.query(
      `insert into ads (competitor_id, creative_id, format, platforms, first_shown, last_shown, days_shown,
         video_url, youtube_video_id, published_at, image_url, headline, description, cta_text, logo_url,
         thumbnail_path, landing_url, landing_domain, regions, raw, collected_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       on conflict (creative_id) do update set
         first_shown   = coalesce(ads.first_shown, excluded.first_shown),
         last_shown    = coalesce(ads.last_shown, excluded.last_shown),
         days_shown    = coalesce(ads.days_shown, excluded.days_shown),
         video_url     = coalesce(ads.video_url, excluded.video_url),
         youtube_video_id = coalesce(ads.youtube_video_id, excluded.youtube_video_id),
         published_at  = coalesce(ads.published_at, excluded.published_at),
         image_url     = coalesce(ads.image_url, excluded.image_url),
         headline      = coalesce(ads.headline, excluded.headline),
         description   = coalesce(ads.description, excluded.description),
         cta_text      = coalesce(ads.cta_text, excluded.cta_text),
         logo_url      = coalesce(ads.logo_url, excluded.logo_url),
         landing_url   = coalesce(ads.landing_url, excluded.landing_url),
         landing_domain= coalesce(ads.landing_domain, excluded.landing_domain),
         raw           = coalesce(ads.raw, excluded.raw)
       returning id, (xmax = 0) as inserted`,
      [
        compMap.get(a.competitor_id), a.creative_id, a.format, a.platforms, a.first_shown, a.last_shown,
        a.days_shown, a.video_url, a.youtube_video_id, a.published_at, a.image_url, a.headline, a.description,
        a.cta_text, a.logo_url, a.thumbnail_path, a.landing_url, a.landing_domain,
        a.regions == null ? null : JSON.stringify(a.regions), a.raw == null ? null : JSON.stringify(a.raw), a.collected_at,
      ],
    );
    adMap.set(a.id, r.rows[0].id);
    if (r.rows[0].inserted) adsNew += 1;
  }
  console.log(`ads: ${la.rows.length}건 처리 (신규 ${adsNew}, 병합 ${la.rows.length - adsNew})`);

  // 3) ad_metrics — (ad_id, snapshot_date) 멱등, 이력 보존
  const lm = await local.query('select * from ad_metrics');
  let mDone = 0;
  for (const m of lm.rows) {
    const aid = adMap.get(m.ad_id);
    if (!aid) continue;
    await azure.query(
      `insert into ad_metrics (ad_id, snapshot_date, yt_view_count, yt_like_count, times_shown_min, times_shown_max)
       values ($1,$2,$3,$4,$5,$6) on conflict (ad_id, snapshot_date) do nothing`,
      [aid, m.snapshot_date, m.yt_view_count, m.yt_like_count, m.times_shown_min, m.times_shown_max],
    );
    mDone += 1;
  }
  console.log(`ad_metrics: ${mDone}건`);

  // 4) ad_variations — (ad_id, idx) 멱등
  const lv = await local.query('select * from ad_variations');
  let vDone = 0;
  for (const v of lv.rows) {
    const aid = adMap.get(v.ad_id);
    if (!aid) continue;
    await azure.query(
      `insert into ad_variations (ad_id, idx, width, height, headline, description, cta_text, logo_url, image_url, landing_url, collected_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (ad_id, idx) do update set
         width = coalesce(ad_variations.width, excluded.width),
         height = coalesce(ad_variations.height, excluded.height),
         headline = coalesce(ad_variations.headline, excluded.headline),
         description = coalesce(ad_variations.description, excluded.description),
         cta_text = coalesce(ad_variations.cta_text, excluded.cta_text),
         logo_url = coalesce(ad_variations.logo_url, excluded.logo_url),
         image_url = coalesce(ad_variations.image_url, excluded.image_url),
         landing_url = coalesce(ad_variations.landing_url, excluded.landing_url)`,
      [aid, v.idx, v.width, v.height, v.headline, v.description, v.cta_text, v.logo_url, v.image_url, v.landing_url, v.collected_at],
    );
    vDone += 1;
  }
  console.log(`ad_variations: ${vDone}건`);

  // 5) users / ad_favorites — 이메일·creative 매핑
  const lu = await local.query('select * from users');
  const userMap = new Map<string, string>();
  for (const u of lu.rows) {
    const r = await azure.query(
      `insert into users (email, password_hash, created_at) values ($1,$2,$3)
       on conflict (email) do update set email = users.email returning id`,
      [u.email, u.password_hash, u.created_at],
    );
    userMap.set(u.id, r.rows[0].id);
  }
  const lf = await local.query('select * from ad_favorites');
  let fDone = 0;
  for (const f of lf.rows) {
    const uid = userMap.get(f.user_id);
    const aid = adMap.get(f.ad_id);
    if (!uid || !aid) continue;
    await azure.query(
      `insert into ad_favorites (user_id, ad_id, created_at) values ($1,$2,$3) on conflict do nothing`,
      [uid, aid, f.created_at],
    );
    fDone += 1;
  }
  console.log(`users: ${lu.rows.length}, favorites: ${fDone}`);
}

main()
  .catch((e) => {
    console.error('이관 실패:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await local.end();
    await azure.end();
  });
