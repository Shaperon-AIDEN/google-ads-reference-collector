// adstransparency.google.com 페이지 컨텍스트에서 실행 (first-party) → RPC 를 실제 세션으로 호출해 /sorry 봇 차단 회피.
// 파싱 로직은 packages/core/src/adapters/ads-source/transparencyCrawl.ts 를 이식.

const RPC_BASE = 'https://adstransparency.google.com/anji/_/rpc';
const REGION_CODE = { KR: 2410, US: 2840, JP: 2392, GB: 2826, DE: 2276, FR: 2250 };
const FORMAT = { 1: 'text', 2: 'image', 3: 'video' };

function toRegion(r) {
  if (!r) return 2410;
  if (/^\d+$/.test(String(r))) return Number(r);
  return REGION_CODE[String(r).toUpperCase()] ?? 2410;
}
function unixToIso(v) {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return new Date(n * 1000).toISOString().slice(0, 10);
}
function daysBetween(first, last) {
  if (!first || !last) return null;
  const a = Date.parse(first), b = Date.parse(last);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000)) + 1;
}
function unescapeHex(s) {
  return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function extractYouTubeId(html) {
  const url = html.match(
    /(?:ytimg\.com\/vi\/|youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/|youtube(?:-nocookie)?\.com\/watch\?v=)([A-Za-z0-9_-]{11})/,
  );
  if (url && url[1]) return url[1];
  const field = html.match(/video_id(?:\\x27|["'])?\s*:?\s*(?:\\x27|["'])([A-Za-z0-9_-]{11})/);
  return field ? field[1] : undefined;
}
function fieldValue(html, field) {
  let m = html.match(new RegExp(`${field}\\\\x27\\s*:\\s*\\\\x27(.*?)\\\\x27`));
  if (!m) m = html.match(new RegExp(`["']${field}["']\\s*:\\s*["']([^"']+)["']`));
  return m && m[1] ? unescapeHex(m[1]).trim() : undefined;
}
function extractLandingUrl(html) {
  const dest = fieldValue(html, 'destination_url');
  if (dest && /^https?:\/\//i.test(dest)) return dest;
  const visible = fieldValue(html, 'visible_url');
  if (visible) {
    if (/^https?:\/\//i.test(visible)) return visible;
    if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(visible)) return `https://${visible}`;
  }
  return undefined;
}
// 미리보기 content.js 안의 모든 이미지(simgad/googleusercontent) 후보 URL 추출(중복 제거, 쿼리 제거).
// content.js 의 이미지는 /archive 없는 /simgad/ 경로라 경로로는 로고/광고를 못 나눈다 → 크기로 판별.
function imageCandidatesFromPreview(html) {
  const re = /https?:\\?\/\\?\/[^"'\\ )]*(?:\/simgad\/|googleusercontent\.com\/)[^"'\\ )]*/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const url = m[0].replace(/\\\//g, '/').replace(/[?&].*$/, ''); // 쿼리(?w=…) 제거
    if (!out.includes(url)) out.push(url);
  }
  return out;
}
// (구) 단일 폴백 — 크롤 어댑터 호환용. 확장은 imageCandidatesFromPreview + 크기측정을 쓴다.
function extractImageUrl(html) {
  const m = html.match(/https?:\\?\/\\?\/[^"'\\ )]*(?:\/simgad\/|googleusercontent\.com\/)[^"'\\ )]*/i);
  return m ? m[0].replace(/\\\//g, '/') : undefined;
}

// --- 백그라운드 워커 경유 (cross-origin 권한) ---
function bg(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}
function report(p) {
  chrome.runtime.sendMessage({ type: 'progress', ...p });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function jitter(base) {
  return base + Math.floor(Math.random() * base);
}

// 이미지 후보들의 실제 크기를 재서 광고 크리에이티브를 고른다.
// 로고는 보통 정사각(ar≈1)·작음, 광고는 배너 비율. → 64px 초과 & 정사각 아님(0.8~1.25 밖) 우선,
// 없으면 가장 큰 것. 각 후보는 background 가 createImageBitmap 으로 측정.
async function pickBestImage(urls) {
  if (!urls || urls.length === 0) return undefined;
  const measured = [];
  for (const url of urls) {
    const s = await bg({ type: 'imageSize', url });
    if (s && s.ok && s.w > 0 && s.h > 0) measured.push({ url, w: s.w, h: s.h });
  }
  if (measured.length === 0) return undefined;
  // ⓘ 아이콘·작은 로고(<=64px) 제외, ~정사각(비율 0.9~1.15)=브랜드 로고 제외 → 배너 크리에이티브만
  const big = measured.filter((m) => Math.max(m.w, m.h) > 64);
  const banner = big.filter((m) => !(m.w / m.h >= 0.9 && m.w / m.h <= 1.15));
  const pool = banner.length ? banner : big;
  if (pool.length === 0) return undefined; // 전부 아이콘/로고
  pool.sort((a, b) => b.w * b.h - a.w * a.h);
  return pool[0].url;
}

// --- same-origin RPC (실제 세션) ---
// credentials:'include' — CAPTCHA 를 풀면 받는 면제 쿠키(GOOGLE_ABUSE_EXEMPTION)를 함께 보내
// /sorry 차단을 우회하기 위함. ⚠️ 단 로그인 상태면 SAPISID 쿠키가 실려 anji 엔드포인트가
// SAPISIDHASH 헤더를 요구하며 400 을 반환한다(content script 는 httpOnly SAPISID 를 못 읽어
// 해시 생성 불가). → **Google 에서 로그아웃한 브라우저/프로필**에서 사용해야 한다.
async function rpc(path, reqObj) {
  let res;
  try {
    res = await fetch(`${RPC_BASE}/${path}?authuser=0`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'f.req=' + encodeURIComponent(JSON.stringify(reqObj)),
      credentials: 'include',
      // redirect:'manual' — 차단 시 /sorry(다른 오리진)로 302 되는데, 이를 따라가면 CORS 로
      // "Failed to fetch" 가 난다. manual 이면 opaqueredirect(status 0) 로 받아 차단 감지 가능.
      redirect: 'manual',
    });
  } catch {
    // fetch 자체 실패(Failed to fetch) = 네트워크 오류 또는 차단 리다이렉트
    throw new Error('BLOCKED');
  }
  // opaqueredirect(status 0/type opaqueredirect) 또는 302 = /sorry 봇 차단
  if (res.type === 'opaqueredirect' || res.status === 0 || res.status === 302) throw new Error('BLOCKED');
  const text = await res.text();
  const t = text.trimStart();
  if (t.startsWith('<')) throw new Error('BLOCKED'); // HTML = 차단 페이지
  if (res.status === 400) throw new Error('RPC 400: Google 로그인 상태로 보임 — 로그아웃한 브라우저/프로필에서 실행하세요(SAPISID 쿠키 충돌).');
  if (!res.ok) throw new Error(`RPC ${res.status}: ${t.slice(0, 80)}`);
  // Google 은 JSON 하이재킹 방지로 )]}' 접두어를 붙일 수 있음 → 정상 응답
  return JSON.parse(t.replace(/^\)\]\}'\s*/, ''));
}

async function listPage(advertiserId, region, num, pageToken) {
  const req = { 2: num, 3: { 12: { 1: '', 2: true }, 13: { 1: [advertiserId] } }, 7: { 1: 1, 2: 0, 3: toRegion(region) } };
  if (pageToken) req['4'] = pageToken;
  const json = await rpc('SearchService/SearchCreatives', req);
  const rows = json['1'] || [];
  const items = rows
    .map((r) => {
      const first = unixToIso(r['6'] && r['6']['1']);
      const last = unixToIso(r['7'] && r['7']['1']);
      return {
        creativeId: typeof r['2'] === 'string' ? r['2'] : '',
        format: FORMAT[Number(r['4'])] || 'text',
        firstShown: first,
        lastShown: last,
        daysShown: daysBetween(first, last),
      };
    })
    .filter((i) => i.creativeId);
  const next = typeof json['2'] === 'string' ? json['2'] : undefined;
  return { items, next };
}

// 이미지 광고: 응답 variation 의 ['3']['2'] 에 <img src="...simgad..."> HTML 직접 포함.
// ⚠️ 실제 광고 크리에이티브는 **/archive/simgad/** 경로다. archive 없는 /simgad/ 는 광고주 **로고**이고
//    (크기 무관 — 2084x2084 대형 로고도 존재), /pagead/ 는 HTML 자산. 둘 다 제외해야 로고 오수집을 막는다.
function isRealCreativeUrl(u) {
  return /\/archive\/simgad\/|googleusercontent\.com\//.test(u) && !/\/pagead\//.test(u);
}
function imageFromVariations(variations) {
  // <img> 가 여러 개면(AdChoices ⓘ 아이콘·로고 + 실제 크리에이티브) width/height 로 가장 큰 것을 고른다.
  // 첫 <img> 만 잡으면 24x24 ⓘ 아이콘이 선택되는 오류. 작은 이미지(<=64px)는 아이콘으로 제외.
  let best; // { url, area }
  for (const v of variations) {
    const html = v && v['3'] && typeof v['3']['2'] === 'string' ? v['3']['2'] : '';
    const re = /<img\b[^>]*>/gi;
    let tag;
    while ((tag = re.exec(html))) {
      const src = (tag[0].match(/src=["']([^"']+)["']/i) || [])[1];
      if (!src || !isRealCreativeUrl(src)) continue;
      const w = Number((tag[0].match(/width=["']?(\d+)/i) || [])[1]) || 0;
      const h = Number((tag[0].match(/height=["']?(\d+)/i) || [])[1]) || 0;
      if (w > 0 && h > 0 && (w <= 64 || h <= 64)) continue; // ⓘ 아이콘·작은 로고 제외
      const area = w * h || 1; // 치수 미상은 최소 점수(그래도 후보)
      if (!best || area > best.area) best = { url: src, area };
    }
  }
  if (best) return best.url;
  return undefined;
}

async function getDetail(advertiserId, creativeId) {
  const json = await rpc('LookupService/GetCreativeById', { 1: advertiserId, 2: creativeId, 5: { 1: 1, 2: 0, 3: 2410 } });
  const variations = (json['1'] && json['1']['5']) || [];
  const previewUrl = variations[0] && variations[0]['1'] && variations[0]['1']['4'];
  // 이미지 광고는 응답에서 바로 추출(미리보기 fetch 불필요), 비디오·텍스트는 미리보기 content.js
  let imageUrl = imageFromVariations(variations);
  let videoUrl, landingUrl, headline, youtubeVideoId;
  if (previewUrl) {
    const r = await bg({ type: 'fetchText', url: previewUrl });
    if (r && r.ok && r.text) {
      youtubeVideoId = extractYouTubeId(r.text);
      if (youtubeVideoId) videoUrl = `https://www.youtube.com/embed/${youtubeVideoId}`;
      else if (!imageUrl) imageUrl = await pickBestImage(imageCandidatesFromPreview(r.text)); // 크기로 로고 제외
      landingUrl = extractLandingUrl(r.text);
    }
  }
  return { youtubeVideoId, videoUrl, imageUrl, landingUrl, headline };
}

async function collectAdvertiser(advertiserId, cfg) {
  const base = cfg.ingestBase.replace(/\/$/, '');
  report({ phase: 'list', advertiserId, message: '목록 조회 중…' });

  // 1) 전체 페이지네이션 → 모든 크리에이티브 목록 (백엔드가 COLLECT_FORMATS 로 스코프 필터)
  const all = [];
  let token, pages = 0;
  while (pages < 300) {
    const { items, next } = await listPage(advertiserId, cfg.region, cfg.num, token);
    for (const it of items) all.push(it);
    pages += 1;
    report({ phase: 'list', advertiserId, message: `목록 ${pages}페이지, ${all.length}건` });
    if (!next) break;
    token = next;
    await sleep(jitter(cfg.delayMs));
  }

  // 2) 이미 저장된 것 제외 (신규만 상세 요청 → 요청 수·차단 위험 최소화)
  const knownRes = await bg({ type: 'post', url: `${base}/known`, body: { creativeIds: all.map((v) => v.creativeId) } });
  const known = new Set((knownRes && knownRes.ok && knownRes.data && knownRes.data.known) || []);
  const fresh = all.filter((v) => !known.has(v.creativeId));
  report({ phase: 'detail', advertiserId, message: `${all.length}건 중 신규 ${fresh.length}건 상세 수집 시작` });

  // 3) 신규만 상세 수집 → flushEvery 건마다 즉시 저장(점진 반영·중단 시 진행분 보존)
  const flushEvery = Math.max(1, cfg.flushEvery || 5);
  let buffer = [];
  let collected = 0;
  let savedTotal = 0;
  let lastError = null;

  // 버퍼를 백엔드로 저장하고 성공 건수를 누적. 실패해도 수집은 계속(다음 flush 에서 재시도되진 않음).
  async function flush() {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    const res = await bg({ type: 'post', url: `${base}/ingest`, body: { advertiserId, ads: batch } });
    if (res && res.ok && res.data) savedTotal += res.data.saved || 0;
    else lastError = (res && res.error) || (res && res.data && res.data.error) || 'ingest 실패';
    report({ phase: 'detail', advertiserId, message: `저장 누적 ${savedTotal}건` });
  }

  let blocked = false;
  for (let i = 0; i < fresh.length; i++) {
    const v = fresh[i];
    try {
      const d = await getDetail(advertiserId, v.creativeId);
      buffer.push({ ...v, ...d });
      collected += 1;
    } catch (e) {
      if (String(e && e.message) === 'BLOCKED') {
        blocked = true;
        report({ phase: 'blocked', advertiserId, message: `⚠️ 차단 감지 — 지금까지 수집분 저장 후 중단` });
        break;
      }
      // 개별 실패는 건너뜀
    }
    if (buffer.length >= flushEvery) await flush(); // flushEvery 건마다 즉시 저장
    report({ phase: 'detail', advertiserId, message: `상세 ${i + 1}/${fresh.length}` });
    await sleep(jitter(cfg.delayMs));
  }
  await flush(); // 잔여분(차단·종료 포함) 저장

  return {
    advertiserId,
    total: all.length,
    fresh: fresh.length,
    collected,
    blocked,
    saved: lastError ? { saved: savedTotal, error: lastError } : { saved: savedTotal },
  };
}

// popup → content 명령 수신
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'collect') return false;
  (async () => {
    const results = [];
    for (const advertiserId of msg.advertiserIds) {
      try {
        results.push(await collectAdvertiser(advertiserId, msg.cfg));
      } catch (e) {
        const blocked = String(e && e.message) === 'BLOCKED';
        const msgText = blocked
          ? '⚠️ Google 봇 차단(/sorry) — IP 가 일시 차단됨. 잠시 후(수십 분) 재시도하거나 요청 간격을 늘리세요. 전체 중단.'
          : String(e && e.message);
        report({ phase: blocked ? 'blocked' : 'error', advertiserId, message: msgText });
        results.push({ advertiserId, error: msgText });
        if (blocked) break; // 차단 시 전체 중단
      }
      await sleep(jitter(msg.cfg.delayMs));
    }
    report({ phase: 'done', message: '완료', results });
    sendResponse({ ok: true, results });
  })();
  return true; // async
});
