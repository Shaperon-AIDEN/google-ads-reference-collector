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
// 필드명 따옴표 유무가 섞여 있다 — `destination_url: \x27값\x27`(무따옴표)와
// `\x27headline\x27: \x27값\x27`(따옴표) 둘 다 잡아야 랜딩 URL 이 확보된다.
function fieldValue(html, field) {
  let m = html.match(new RegExp(`(?:\\\\x27|["'])?${field}(?:\\\\x27|["'])?\\s*:\\s*\\\\x27(.*?)\\\\x27`));
  if (!m) m = html.match(new RegExp(`["']?${field}["']?\\s*:\\s*["']([^"']+)["']`));
  return m && m[1] ? unescapeHex(m[1]).trim() : undefined;
}
// content.js 의 logo 필드 — base64 데이터 URI(~10KB) 또는 http URL. URL 형태 아니면 버림.
function extractLogo(html) {
  const v = fieldValue(html, 'logo');
  if (v && (/^data:image\//.test(v) || /^https?:\/\//.test(v))) return v;
  return undefined;
}
// ⚠️ content.js 템플릿은 두 종류(실측): adData JSON(→ fieldValue)과 **HTML 마크업 템플릿**
// (creativeType 46 이미지 레이아웃 — adData 없이 완성 HTML). 후자는 title/body 클래스 div 의
// <a> 텍스트, data-asoch-targets="…btnClk…" 앵커(CTA), adurl= 파라미터(랜딩),
// 정사각 소형(w=h≤200) background-image simgad(로고)에서 추출한다.
function componentsFromHtmlTemplate(rawHtml) {
  const d = unescapeHex(rawHtml);
  const clean = (s) =>
    s
      ? s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || undefined
      : undefined;
  const pick = (cls) => {
    const m = d.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*>\\s*<a[^>]*>([\\s\\S]*?)</a>`));
    return clean(m && m[1]);
  };
  const out = { headline: pick('title'), description: pick('body') };
  for (const m of d.matchAll(/<a[^>]*data-asoch-targets="[^"]*btnClk[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    out.ctaText = clean(m[1]);
    if (out.ctaText) break;
  }
  const adurl = (d.match(/adurl=([^&"'\s]+)/) || [])[1];
  if (adurl) {
    try {
      const u = decodeURIComponent(adurl);
      if (/^https?:\/\//i.test(u)) out.landingUrl = u;
    } catch {}
  }
  for (const m of d.matchAll(/background-image:url\((https?:\/\/[^)]*\/simgad\/[^)?]+)\?w=(\d+)&h=(\d+)/g)) {
    if (Number(m[2]) === Number(m[3]) && Number(m[2]) <= 200) {
      out.logoUrl = m[1]; // 쿼리 제거 → 원본 해상도
      break;
    }
  }
  return out;
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

// 페이지 HTML 에서 XSRF 토큰 탐색 (Google Apps Framework). 쿠키를 보낼 때 CSRF 방어가
// 발동해 토큰을 요구하므로(없으면 400 XsrfException) 함께 실어야 한다.
function findXsrfToken() {
  try {
    const html = document.documentElement.outerHTML;
    const m =
      html.match(/"xsrf[_-]?token"\s*:\s*"([^"]{10,})"/i) ||
      html.match(/xsrfToken['"]?\s*[:=]\s*['"]([^'"]{10,})['"]/i) ||
      html.match(/"SNlM0e"\s*:\s*"([^"]{10,})"/);
    return m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

// --- same-origin RPC (실제 세션) ---
// 쿠키 전송(credentials:'include')은 CAPTCHA 면제 쿠키(GOOGLE_ABUSE_EXEMPTION)를 활용해
// /sorry 차단을 우회하려는 목적. ⚠️ 단 **쿠키가 실리면 anji 가 XSRF 토큰을 요구**한다
// (실측: `XsrfException: XSRF token is MISSING`, 400). 로그인 여부와 무관하게 NID 등
// 쿠키만 있어도 발동하므로, 페이지에서 토큰을 찾아 헤더로 함께 보낸다.
// 토큰을 못 찾으면 XSRF 검사가 없는 **익명 호출(credentials:'omit')로 폴백**한다.
async function rpc(path, reqObj) {
  const token = findXsrfToken();
  const headers = { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' };
  if (token) headers['x-framework-xsrf-token'] = token;

  async function attempt(creds) {
    return fetch(`${RPC_BASE}/${path}?authuser=0`, {
      method: 'POST',
      headers,
      body: 'f.req=' + encodeURIComponent(JSON.stringify(reqObj)),
      credentials: creds,
      // redirect:'manual' — 차단 시 /sorry(다른 오리진)로 302 되는데, 이를 따라가면 CORS 로
      // "Failed to fetch" 가 난다. manual 이면 opaqueredirect(status 0) 로 받아 차단 감지 가능.
      redirect: 'manual',
    });
  }

  let res;
  try {
    // 토큰이 있으면 쿠키 포함(면제 쿠키 활용), 없으면 처음부터 익명
    res = await attempt(token ? 'include' : 'omit');
  } catch {
    throw new Error('BLOCKED'); // fetch 실패 = 네트워크 오류 또는 차단 리다이렉트
  }
  if (res.type === 'opaqueredirect' || res.status === 0 || res.status === 302) throw new Error('BLOCKED');

  let text = await res.text();
  // 쿠키를 보냈는데 XSRF 로 거부되면(토큰이 틀렸거나 만료) 익명으로 재시도
  if (res.status === 400 && /Xsrf/i.test(text)) {
    try {
      res = await attempt('omit');
    } catch {
      throw new Error('BLOCKED');
    }
    if (res.type === 'opaqueredirect' || res.status === 0 || res.status === 302) throw new Error('BLOCKED');
    text = await res.text();
  }

  const t = text.trimStart();
  if (t.startsWith('<')) throw new Error('BLOCKED'); // HTML = 차단 페이지
  if (!res.ok) {
    // 응답 본문을 반드시 노출한다 — 본문 없이는 원인을 오진하게 된다.
    throw new Error(`RPC ${res.status}: ${t.slice(0, 200) || '(본문 없음)'}`);
  }
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

// 미리보기 content.js URL 을 **모든** variation 에서 모은다.
// ⚠️ variations[0] 만 보면 안 된다(실측): 이미지 광고는 index 0 이 ['3']['2'](정적 img HTML)이라
// ['1']['4'] 가 없고 미리보기 URL 은 뒤쪽 variation 에만 있다 → 문구·CTA·랜딩이 통째로 누락됐다.
function previewUrls(variations) {
  const out = [];
  for (const v of variations) {
    const u = v && v['1'] && v['1']['4'];
    if (typeof u === 'string' && u && !out.includes(u)) out.push(u);
  }
  return out;
}

async function getDetail(advertiserId, creativeId, format) {
  const json = await rpc('LookupService/GetCreativeById', { 1: advertiserId, 2: creativeId, 5: { 1: 1, 2: 0, 3: 2410 } });
  const variations = (json['1'] && json['1']['5']) || [];
  // 이미지 광고는 응답에서 바로 추출(미리보기 fetch 불필요), 문구·랜딩은 미리보기 content.js 에서
  let imageUrl = imageFromVariations(variations);
  let videoUrl, landingUrl, headline, description, ctaText, logoUrl, youtubeVideoId;
  const varDetails = [];

  // 대안(variation)별 미리보기를 순회하며 각자의 사이즈·구성요소를 추출.
  // 비디오는 동일 영상의 사이즈 변형이라 문구 확보 시 조기 중단(요청 절약),
  // 이미지·텍스트는 대안마다 문구·CTA·사이즈가 다르므로 전부 수집(최대 6개).
  const isVideo = format === 'video';
  const urls = previewUrls(variations).slice(0, isVideo ? 3 : 6);
  for (let idx = 0; idx < urls.length; idx++) {
    const r = await bg({ type: 'fetchText', url: urls[idx] });
    if (!r || !r.ok || !r.text) continue;
    if (!youtubeVideoId) {
      youtubeVideoId = extractYouTubeId(r.text);
      if (youtubeVideoId) videoUrl = `https://www.youtube.com/embed/${youtubeVideoId}`;
    }
    // 대안별 구성요소 — adData JSON 우선, 없으면 HTML 마크업 템플릿 파서
    const t = componentsFromHtmlTemplate(r.text);
    const v = {
      idx,
      headline: fieldValue(r.text, 'headline') || fieldValue(r.text, 'longHeadline') || t.headline,
      description: fieldValue(r.text, 'description') || fieldValue(r.text, 'body_text') || t.description,
      ctaText: fieldValue(r.text, 'callToActionText') || t.ctaText,
      logoUrl: extractLogo(r.text) || t.logoUrl,
      imageUrl: t.imageUrl,
      landingUrl: extractLandingUrl(r.text) || t.landingUrl,
    };
    const size = r.text.match(/"width"\s*:\s*(\d+)\s*,\s*"height"\s*:\s*(\d+)/);
    if (size) {
      v.width = Number(size[1]);
      v.height = Number(size[2]);
    }
    varDetails.push(v);

    // 광고 대표값 = 처음 확보된 값 (목록 카드·검색용)
    headline = headline || v.headline;
    description = description || v.description;
    ctaText = ctaText || v.ctaText;
    logoUrl = logoUrl || v.logoUrl;
    landingUrl = landingUrl || v.landingUrl;
    // 비디오라도 배너 이미지가 따로 있으면 확보(discover 레이아웃 = 배너+텍스트 조합)
    if (!imageUrl) imageUrl = v.imageUrl || (await pickBestImage(imageCandidatesFromPreview(r.text)));

    if (isVideo && (headline || description)) break;
    await sleep(200); // 대안 간 소간격 (본 딜레이는 광고 간에 적용)
  }
  // raw 는 그대로 보존해 저장한다(프로젝트 규칙) — 형식이 바뀌거나 추출이 실패했을 때
  // 재수집 없이 DB 의 raw 로 원인을 진단할 수 있다.
  return {
    youtubeVideoId,
    videoUrl,
    imageUrl,
    landingUrl,
    headline,
    description,
    ctaText,
    logoUrl,
    variations: varDetails.length ? varDetails : undefined,
    raw: json,
  };
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
      const d = await getDetail(advertiserId, v.creativeId, v.format);
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

// ===== 스크린샷용 대안 iframe 측정 (background 의 captureVisibleTab 이 크롭할 좌표 제공) =====
// 광고 상세 페이지의 대안 카드는 각각 fletch-render iframe: id 에 `_preview_c…_v<N>_<w>_<h>_` 포함.
function variationIframes() {
  const list = [...document.querySelectorAll('iframe[id*="_preview_"]')]
    .map((el) => {
      const m = el.id.match(/_v(\d+)_(\d+)_(\d+)_/);
      return { el, idx: m ? Number(m[1]) : 0, width: m ? Number(m[2]) : 0, height: m ? Number(m[3]) : 0 };
    })
    .sort((a, b) => a.idx - b.idx);
  return list;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'waitVariations') {
    (async () => {
      // iframe 이 나타날 때까지 대기(최대 20초)
      let found = 0;
      for (let i = 0; i < 40; i++) {
        found = variationIframes().length;
        if (found > 0) break;
        await sleep(500);
      }
      if (found === 0) return sendResponse({ ok: false, error: '대안 iframe 을 찾지 못함' });
      // ⚠️ 대안 카드는 뷰포트에 들어와야 렌더를 시작한다(지연 렌더) — 화면 밖 대안을 바로
      // 찍으면 빈 영역이 캡처된다. 전체 대안을 한 번씩 스크롤해 렌더를 트리거(프리워밍)한 뒤
      // 렌더 완료(실측 ~6초)를 기다린다.
      for (const v of variationIframes()) {
        v.el.scrollIntoView({ block: 'center', behavior: 'instant' });
        await sleep(400);
      }
      await sleep(msg.renderWaitMs || 6000);
      sendResponse({ ok: true, count: variationIframes().length });
    })();
    return true;
  }
  if (msg?.type === 'focusVariation') {
    (async () => {
      const list = variationIframes();
      const v = list[msg.pos];
      if (!v) return sendResponse({ ok: false });
      v.el.scrollIntoView({ block: 'center', behavior: 'instant' });
      await sleep(800); // 스크롤 정착 + 재합성 대기
      const r = v.el.getBoundingClientRect();
      sendResponse({
        ok: true,
        idx: v.idx,
        width: v.width || Math.round(r.width),
        height: v.height || Math.round(r.height),
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        dpr: window.devicePixelRatio || 1,
      });
    })();
    return true;
  }
  return false;
});

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
