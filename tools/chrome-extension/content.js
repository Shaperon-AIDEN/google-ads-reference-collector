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
// 이미지 광고 크리에이티브 URL (best-effort) — Google 디스플레이 이미지는 /simgad/ 또는 googleusercontent/tpc
function extractImageUrl(html) {
  const m = html.match(
    /https?:\\?\/\\?\/[^"'\\ )]*(?:\/simgad\/|googleusercontent\.com|tpc\.googlesyndication\.com)[^"'\\ )]*/i,
  );
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

// --- same-origin RPC (실제 세션) ---
// credentials:'omit' — 쿠키를 보내면 anji 엔드포인트가 인증 요청으로 간주해 SAPISIDHASH 헤더를
// 요구하며 400 을 반환한다. 투명성 센터는 공개 데이터라 curl 처럼 익명 호출해야 정상 동작한다.
// (실제 브라우저의 TLS 지문·IP·Origin/Referer 이점은 쿠키와 무관하게 유지 → /sorry 회피는 그대로)
async function rpc(path, reqObj) {
  const res = await fetch(`${RPC_BASE}/${path}?authuser=0`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'f.req=' + encodeURIComponent(JSON.stringify(reqObj)),
    credentials: 'omit',
  });
  const text = await res.text();
  const t = text.trimStart();
  // HTML/리다이렉트 = /sorry 봇 차단
  if (t.startsWith('<') || res.status === 302) throw new Error('BLOCKED');
  if (!res.ok) throw new Error(`RPC ${res.status}: ${t.slice(0, 80)}`); // 본문 앞부분으로 원인 파악
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

async function getDetail(advertiserId, creativeId) {
  const json = await rpc('LookupService/GetCreativeById', { 1: advertiserId, 2: creativeId, 5: { 1: 1, 2: 0, 3: 2410 } });
  const variations = (json['1'] && json['1']['5']) || [];
  const previewUrl = variations[0] && variations[0]['1'] && variations[0]['1']['4'];
  let videoUrl, imageUrl, landingUrl, headline, youtubeVideoId;
  if (previewUrl) {
    const r = await bg({ type: 'fetchText', url: previewUrl });
    if (r && r.ok && r.text) {
      youtubeVideoId = extractYouTubeId(r.text);
      if (youtubeVideoId) videoUrl = `https://www.youtube.com/embed/${youtubeVideoId}`;
      else imageUrl = extractImageUrl(r.text); // 비디오가 아니면 이미지 크리에이티브(best-effort)
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

  // 3) 신규만 상세 수집 (페이싱)
  const ads = [];
  for (let i = 0; i < fresh.length; i++) {
    const v = fresh[i];
    try {
      const d = await getDetail(advertiserId, v.creativeId);
      ads.push({ ...v, ...d });
    } catch (e) {
      if (String(e && e.message) === 'BLOCKED') {
        report({ phase: 'blocked', advertiserId, message: `⚠️ 차단 감지 — ${ads.length}건까지 저장 후 중단` });
        break;
      }
      // 개별 실패는 건너뜀
    }
    report({ phase: 'detail', advertiserId, message: `상세 ${i + 1}/${fresh.length}` });
    await sleep(jitter(cfg.delayMs));
  }

  // 4) 백엔드 저장
  let saved = null;
  if (ads.length > 0) {
    const res = await bg({ type: 'post', url: `${base}/ingest`, body: { advertiserId, ads } });
    saved = res && res.ok ? res.data : { error: (res && res.error) || (res && res.data && res.data.error) };
  }
  return { advertiserId, total: all.length, fresh: fresh.length, collected: ads.length, saved };
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
        report({ phase: 'error', advertiserId, message: String(e && e.message) });
        results.push({ advertiserId, error: String(e && e.message) });
        if (String(e && e.message) === 'BLOCKED') break; // 차단 시 전체 중단
      }
      await sleep(jitter(msg.cfg.delayMs));
    }
    report({ phase: 'done', message: '완료', results });
    sendResponse({ ok: true, results });
  })();
  return true; // async
});
