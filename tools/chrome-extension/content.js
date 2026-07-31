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
  // 쇼핑(PLA) 마크업 변형: 상품명이 <a> 가 아니라 product-name div 안 <span> 에 있다
  const pickBlock = (cls) => {
    const m = d.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]{0,400}?)</div>`));
    return clean(m && m[1]);
  };
  const out = { headline: pick('title') || pickBlock('product-name'), description: pick('body') };
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
  // 쇼핑(PLA) 마크업 변형: 상품 이미지가 encrypted-tbn 배경이미지로 온다 (쿼리 q=tbn:… 유지)
  if (!out.imageUrl) {
    const tbn = d.match(/background-image:url\((https:\/\/encrypted-tbn[^)\s"']+)\)/);
    if (tbn) out.imageUrl = tbn[1];
  }
  return out;
}
// content.js 세 번째 템플릿(실측): "Single Ad Rendering Service"(검색형 텍스트 광고).
// AF_dataServiceRequests 의 "361903925" 배열 [ …null×7, headline, visibleUrl, description, … ].
// 크리에이티브 이미지는 원래 없는 유형(내장 data:image 는 별점 등 UI 아이콘).
function componentsFromSearchAdTemplate(rawHtml) {
  const d = unescapeHex(rawHtml);
  const m = d.match(/"361903925":\[(?:[^,"[\]]*,){7}"((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)"/);
  if (!m) return {};
  const dec = (s) => {
    try {
      return JSON.parse('"' + s + '"');
    } catch {
      return s;
    }
  };
  const out = {};
  const headline = dec(m[1]).trim();
  const visible = dec(m[2]).trim();
  const description = dec(m[3]).trim();
  if (headline) out.headline = headline;
  if (description) out.description = description;
  if (/^https?:\/\//i.test(visible)) out.landingUrl = visible;
  else if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(visible)) out.landingUrl = 'https://' + visible;
  return out;
}
// content.js 네 번째 템플릿(실측): 쇼핑 광고(PLA). <c-wiz data-p="%.@.[&quot;<상품이미지>&quot;,
// &quot;<상품명>&quot;,…]"> 에 들어있다. 상품 이미지는 encrypted-tbn*.gstatic.com/shopping?q=tbn:…
// (쿼리가 식별자 — 제거 금지).
function componentsFromPlaTemplate(rawHtml) {
  const d = unescapeHex(rawHtml);
  const m = d.match(/data-p="%\.@\.\[&quot;(https:\/\/encrypted-tbn[^"]*?)&quot;,&quot;((?:(?!&quot;).)*?)&quot;/);
  if (!m) return {};
  const dec = (s) =>
    s
      .replace(/\\\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&amp;/g, '&')
      .trim();
  const out = {};
  const img = dec(m[1]);
  const title = dec(m[2]);
  if (/^https:\/\//.test(img)) out.imageUrl = img;
  if (title) out.headline = title;
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
    // 대안별 구성요소 — adData JSON → HTML 마크업 → 검색형(Single Ad) → 쇼핑(PLA) 순 폴백
    const t = componentsFromHtmlTemplate(r.text);
    const s = componentsFromSearchAdTemplate(r.text);
    const pla = componentsFromPlaTemplate(r.text);
    const v = {
      idx,
      headline:
        fieldValue(r.text, 'headline') || fieldValue(r.text, 'longHeadline') || t.headline || s.headline || pla.headline,
      // 'body'·'callToAction' 은 텍스트+로고 합성형(gpa) 템플릿의 필드명 (실측)
      description:
        fieldValue(r.text, 'description') || fieldValue(r.text, 'body_text') || fieldValue(r.text, 'body') || t.description || s.description,
      ctaText: fieldValue(r.text, 'callToActionText') || fieldValue(r.text, 'callToAction') || t.ctaText,
      logoUrl: extractLogo(r.text) || t.logoUrl,
      imageUrl: t.imageUrl || pla.imageUrl,
      landingUrl: extractLandingUrl(r.text) || t.landingUrl || s.landingUrl,
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
    // ⚠️ 로고로 판정된 URL 은 이미지 후보에서 제외한다 — 정사각 폴백이 로고를 광고 이미지로
    // 오선택하던 버그(실측: Hättke 1000² 로고가 4개 광고의 image_url 로 저장됨).
    const logoBase = (v.logoUrl || logoUrl || '').split('?')[0];
    if (!imageUrl) {
      const cands = imageCandidatesFromPreview(r.text).filter((u) => !logoBase || u.split('?')[0] !== logoBase);
      imageUrl = v.imageUrl || (await pickBestImage(cands));
    }
    if (imageUrl && logoBase && imageUrl.split('?')[0] === logoBase) imageUrl = undefined;

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

// ===== 수집 백로그 (chrome.storage) =====
// 목록·신규판정 결과를 저장해 두고, 한도/차단으로 멈췄다 재개할 때 **목록 재수집 없이** 이어서
// 상세만 수집한다. 백로그가 비면 삭제 → 다음 수집은 새로 목록부터.
async function loadBacklog() {
  const { pendingWork } = await chrome.storage.local.get('pendingWork');
  return pendingWork && Array.isArray(pendingWork.items) && pendingWork.items.length ? pendingWork : null;
}
async function saveBacklog(items, meta) {
  if (!items.length) return chrome.storage.local.remove('pendingWork');
  await chrome.storage.local.set({ pendingWork: { items, meta, savedAt: Date.now() } });
}

// 광고주들의 목록을 순회해 신규 작업 목록을 만든다 (상세 수집 전 단계)
async function buildBacklog(advertiserIds, cfg) {
  const base = cfg.ingestBase.replace(/\/$/, '');
  const items = [];
  const totals = {};
  for (const advertiserId of advertiserIds) {
    report({ phase: 'list', advertiserId, message: '목록 조회 중…' });
    const all = [];
    let token, pages = 0;
    while (pages < 300) {
      const { items: page, next } = await listPage(advertiserId, cfg.region, cfg.num, token);
      for (const it of page) all.push(it);
      pages += 1;
      report({ phase: 'list', advertiserId, message: `목록 ${pages}페이지, ${all.length}건` });
      if (!next) break;
      token = next;
      await sleep(jitter(cfg.delayMs));
    }
    totals[advertiserId] = all.length;
    // 이미 저장된 것 제외 (신규만 상세 요청 → 요청 수·차단 위험 최소화)
    const knownRes = await bg({ type: 'post', url: `${base}/known`, body: { creativeIds: all.map((v) => v.creativeId) } });
    const known = new Set((knownRes && knownRes.ok && knownRes.data && knownRes.data.known) || []);
    for (const v of all) if (!known.has(v.creativeId)) items.push({ advertiserId, ...v });
    report({ phase: 'detail', advertiserId, message: `${all.length}건 중 신규 ${items.filter((i) => i.advertiserId === advertiserId).length}건` });
  }
  return { items, meta: { totals } };
}

// 백로그의 상세를 수집한다. 연속 한도(maxPerRun)에 닿으면 restIntervalMs 만큼 쉬었다가
// **자동 재개**해 완주한다. 차단 시엔 백로그를 보존하고 중단(다음 실행이 이어서).
async function processBacklog(backlog, cfg) {
  const base = cfg.ingestBase.replace(/\/$/, '');
  const flushEvery = Math.max(1, cfg.flushEvery || 5);
  const maxPerRun = Number(cfg.maxPerRun) > 0 ? Number(cfg.maxPerRun) : 500;
  const restMs = Math.max(0, Number(cfg.restIntervalMs) || 0);
  const items = backlog.items;
  const totalWork = items.length;

  const buffers = new Map(); // advertiserId → ads[]
  const savedByAdv = {};
  let lastError = null;
  let windowCount = 0;
  let doneCount = 0;
  let blocked = false;

  async function flushAll() {
    for (const [advertiserId, ads] of buffers) {
      if (!ads.length) continue;
      buffers.set(advertiserId, []);
      const res = await bg({ type: 'post', url: `${base}/ingest`, body: { advertiserId, ads } });
      if (res && res.ok && res.data) savedByAdv[advertiserId] = (savedByAdv[advertiserId] || 0) + (res.data.saved || 0);
      else lastError = (res && res.error) || (res && res.data && res.data.error) || 'ingest 실패';
    }
  }

  while (items.length > 0) {
    // 연속 한도 도달 → 저장·백로그 보존 후 인터벌만큼 쉬고 자동 재개
    if (windowCount >= maxPerRun) {
      await flushAll();
      await saveBacklog(items, backlog.meta);
      if (restMs <= 0) {
        report({ phase: 'detail', message: `연속 한도(${maxPerRun}건) 도달 — 중단 (다음 "수집 시작"이 이어서, 남은 ${items.length}건)` });
        return { blocked: false, remaining: items.length, savedByAdv, lastError };
      }
      const until = new Date(Date.now() + restMs).toLocaleTimeString('ko-KR');
      report({ phase: 'rest', message: `연속 한도(${maxPerRun}건) 도달 — ${Math.round(restMs / 60000)}분 휴식 후 자동 재개 (${until}, 남은 ${items.length}건)` });
      await sleep(restMs);
      windowCount = 0;
      report({ phase: 'detail', message: '휴식 종료 — 수집 재개' });
    }

    const v = items[0];
    try {
      const d = await getDetail(v.advertiserId, v.creativeId, v.format);
      if (!buffers.has(v.advertiserId)) buffers.set(v.advertiserId, []);
      const { advertiserId: _a, ...rest } = v;
      buffers.get(v.advertiserId).push({ ...rest, ...d });
      windowCount += 1;
    } catch (e) {
      if (String(e && e.message) === 'BLOCKED') {
        blocked = true;
        report({ phase: 'blocked', message: '⚠️ 차단 감지 — 진행분 저장·백로그 보존 후 중단 (다음 실행이 이어서)' });
        break;
      }
      // 개별 실패는 건너뜀 (백로그에서 제거)
    }
    items.shift();
    doneCount += 1;
    const pending = [...buffers.values()].reduce((n, a) => n + a.length, 0);
    if (pending >= flushEvery) await flushAll();
    if (doneCount % 10 === 0 || items.length === 0) {
      report({ phase: 'detail', message: `상세 ${doneCount}/${totalWork} (저장 누적 ${Object.values(savedByAdv).reduce((a, b) => a + b, 0)}건)` });
      await saveBacklog(items, backlog.meta); // 주기 저장 — 탭이 닫혀도 진행 보존
    }
    await sleep(jitter(cfg.delayMs));
  }

  await flushAll();
  await saveBacklog(items, backlog.meta); // 빈 배열이면 백로그 삭제
  return { blocked, remaining: items.length, savedByAdv, lastError };
}

// popup/background → content 명령 수신
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'collect') return false;
  (async () => {
    const cfg = msg.cfg;
    // 미완료 백로그가 있으면 목록 재수집 없이 이어서, 없으면 목록부터
    let backlog = await loadBacklog();
    if (backlog) {
      report({ phase: 'detail', message: `이전 미완료 작업 ${backlog.items.length}건 발견 — 목록 재수집 없이 이어서 수집` });
    } else {
      try {
        backlog = await buildBacklog(msg.advertiserIds, cfg);
        await saveBacklog(backlog.items, backlog.meta);
      } catch (e) {
        const isBlocked = String(e && e.message) === 'BLOCKED';
        report({ phase: isBlocked ? 'blocked' : 'error', message: isBlocked ? '⚠️ 차단 감지 — 목록 단계 중단' : String(e && e.message) });
        sendResponse({ ok: false, error: String(e && e.message) });
        return;
      }
    }

    const r = await processBacklog(backlog, cfg);
    const summary = Object.entries(r.savedByAdv).map(([a, n]) => `${a}: 저장 ${n}건`);
    report({
      phase: 'done',
      message: r.blocked
        ? `차단으로 중단 — 남은 ${r.remaining}건은 백로그 보존됨 (다음 실행이 이어서)`
        : r.remaining > 0
          ? `한도 중단 — 남은 ${r.remaining}건 백로그 보존`
          : '완료',
      results: summary.map((s) => ({ advertiserId: s, saved: {} })),
    });
    sendResponse({ ok: true, summary, remaining: r.remaining, blocked: r.blocked, error: r.lastError });
  })();
  return true; // async
});
