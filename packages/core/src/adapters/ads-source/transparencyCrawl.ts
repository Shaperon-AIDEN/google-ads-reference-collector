import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isRealCreativeUrl, type AdFormat } from '../../domain/models.js';
import type {
  AdDetail,
  AdListItem,
  AdsSource,
  AdVariationDetail,
  AdvertiserCandidate,
  GetAdDetailParams,
  ListAdsParams,
  SearchAdvertisersParams,
} from './types.js';

const execFileAsync = promisify(execFile);

const BASE = 'https://adstransparency.google.com/anji/_/rpc';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// ISO 국가 코드 → Google geo target region 코드 (SearchCreatives 요청 field 7.3)
const REGION_CODE: Record<string, number> = { KR: 2410, US: 2840, JP: 2392, GB: 2826, DE: 2276, FR: 2250 };
function toGoogleRegion(region?: string): number {
  if (!region) return 2410;
  if (/^\d+$/.test(region)) return Number(region);
  return REGION_CODE[region.toUpperCase()] ?? 2410;
}

const FORMAT: Record<number, AdFormat> = { 1: 'text', 2: 'image', 3: 'video' };

type Json = Record<string, unknown>;

function unixToIso(v: unknown): string | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return new Date(n * 1000).toISOString().slice(0, 10);
}
function daysBetween(first?: string, last?: string): number | undefined {
  if (!first || !last) return undefined;
  const a = Date.parse(first);
  const b = Date.parse(last);
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined;
  return Math.max(0, Math.round((b - a) / 86_400_000)) + 1;
}
/** content.js 미리보기에서 YouTube video ID 추출 (URL 형식 + video_id 필드 형식 모두) */
function extractYouTubeId(html: string): string | undefined {
  const url = html.match(
    /(?:ytimg\.com\/vi\/|youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/|youtube(?:-nocookie)?\.com\/watch\?v=)([A-Za-z0-9_-]{11})/,
  );
  if (url?.[1]) return url[1];
  // YouTube player media 레이아웃: \x27video_id\x27: \x27<id>\x27 또는 "video_id":"<id>"
  const field = html.match(/video_id(?:\\x27|["'])?\s*:?\s*(?:\\x27|["'])([A-Za-z0-9_-]{11})/);
  return field?.[1];
}

/** content.js 미리보기에서 이미지 광고 크리에이티브 URL 추출 (best-effort, 폴백용).
 *  Google 디스플레이 이미지는 /simgad/ 또는 googleusercontent 에서 서빙됨.
 *  (tpc.googlesyndication.com 은 JS·HTML 도 서빙하므로 /simgad/ 경로로만 한정 — 오탐 방지) */
function extractImageUrl(html: string): string | undefined {
  const m = html.match(/https?:\\?\/\\?\/[^"'\\ )]*(?:\/simgad\/|googleusercontent\.com\/)[^"'\\ )]*/i);
  return m ? m[0].replace(/\\\//g, '/') : undefined;
}

/**
 * 이미지 광고는 GetCreativeById 응답 variation 의 `['3']['2']` 에 `<img src="...simgad...">` HTML 이
 * 직접 들어있다(미리보기 fetch 불필요). 첫 유효 img src 를 반환. (비디오·텍스트는 대신 `['1']['4']` 미리보기 URL)
 */
function imageFromVariations(variations: Json[]): string | undefined {
  // <img> 가 여러 개면(AdChoices ⓘ 아이콘·로고 + 실제 크리에이티브) width/height 로 판별.
  // 작은 이미지(<=64px)=아이콘, 정사각(로고)은 제외하고 배너 비율 중 가장 큰 것을 고른다.
  // (여기 ['3']['2'] 응답 직접 이미지는 width/height 속성이 항상 있음)
  const cands: { url: string; area: number; square: boolean }[] = [];
  for (const v of variations) {
    const inner = v?.['3'] as Json | undefined;
    const html = typeof inner?.['2'] === 'string' ? (inner['2'] as string) : '';
    const re = /<img\b[^>]*>/gi;
    let tag: RegExpExecArray | null;
    while ((tag = re.exec(html))) {
      const src = (tag[0].match(/src=["']([^"']+)["']/i) ?? [])[1];
      if (!src || !isRealCreativeUrl(src)) continue;
      const w = Number((tag[0].match(/width=["']?(\d+)/i) ?? [])[1]) || 0;
      const h = Number((tag[0].match(/height=["']?(\d+)/i) ?? [])[1]) || 0;
      if (w > 0 && h > 0 && (w <= 64 || h <= 64)) continue; // ⓘ 아이콘·작은 로고 제외
      const r = w > 0 && h > 0 ? w / h : 0;
      cands.push({ url: src, area: w * h || 1, square: r >= 0.9 && r <= 1.15 }); // ~정사각만 로고로 간주
    }
  }
  // 정사각(로고)은 제외한다. 배너 비율만 남기고 가장 큰 것을 고른다.
  // (정사각뿐이면 로고만 있는 광고 → imageUrl 없음)
  const nonSquare = cands.filter((c) => !c.square);
  nonSquare.sort((a, b) => b.area - a.area);
  return nonSquare[0]?.url;
}

/**
 * 미리보기 content.js URL 을 **모든** variation 에서 모은다.
 * ⚠️ variations[0] 만 보면 안 된다(실측): 이미지 광고는 index 0 이 `['3']['2']`(정적 img HTML)이라
 * `['1']['4']` 가 없고, 미리보기 URL 은 뒤쪽 variation 에만 있다 → 문구·CTA·랜딩이 통째로 누락됐다.
 * variation 마다 레이아웃이 달라(allowedVariations) 문구 유무도 다르므로 순서대로 시도한다.
 */
function previewUrls(variations: Json[]): string[] {
  const out: string[] = [];
  for (const v of variations) {
    const u = (v?.['1'] as Json | undefined)?.['4'];
    if (typeof u === 'string' && u && !out.includes(u)) out.push(u);
  }
  return out;
}

/**
 * content.js 의 `logo` 필드에서 브랜드 로고 추출. 실측상 base64 데이터 URI(~10KB) 또는
 * http URL 로 온다. URL 형태가 아닌 값(레이아웃 키워드 등)은 버린다.
 */
function extractLogo(html: string): string | undefined {
  const v = fieldValue(html, 'logo');
  if (v && (/^data:image\//.test(v) || /^https?:\/\//.test(v))) return v;
  return undefined;
}

/**
 * ⚠️ content.js 템플릿은 두 종류다(실측):
 *  1) adData JSON 템플릿(discover 등) — `\x27headline\x27: \x27…\x27` → fieldValue 로 추출
 *  2) **HTML 마크업 템플릿**(creativeType 46 이미지 레이아웃) — adData 없이 완성 HTML 이 들어있다.
 *     문구는 `title`/`body` 클래스 div 안의 <a> 텍스트, CTA 는 `data-asoch-targets="…btnClk…"` 앵커,
 *     랜딩은 클릭 URL 의 `adurl=` 파라미터, 로고는 정사각 소형(w=h≤200) background-image simgad.
 * fieldValue 가 못 찾으면 이 파서가 폴백으로 뛴다.
 */
function componentsFromHtmlTemplate(rawHtml: string): {
  headline?: string;
  description?: string;
  ctaText?: string;
  landingUrl?: string;
  logoUrl?: string;
  imageUrl?: string;
} {
  const d = unescapeHex(rawHtml);
  const clean = (s: string | undefined) =>
    s
      ? s
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim() || undefined
      : undefined;
  const pick = (cls: string) =>
    clean(d.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*>\\s*<a[^>]*>([\\s\\S]*?)</a>`))?.[1]);

  const headline = pick('title');
  const description = pick('body');

  let ctaText: string | undefined;
  for (const m of d.matchAll(/<a[^>]*data-asoch-targets="[^"]*btnClk[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    ctaText = clean(m[1]);
    if (ctaText) break;
  }

  let landingUrl: string | undefined;
  const adurl = d.match(/adurl=([^&"'\s]+)/)?.[1];
  if (adurl) {
    try {
      const u = decodeURIComponent(adurl);
      if (/^https?:\/\//i.test(u)) landingUrl = u;
    } catch {
      // 잘못된 인코딩은 무시
    }
  }

  // 배경이미지 simgad 를 로고(정사각 소형 w=h≤200)와 배너(그 외, 최대 면적)로 분류
  let logoUrl: string | undefined;
  let imageUrl: string | undefined;
  let bestArea = 0;
  for (const m of d.matchAll(/background-image:url\((https?:\/\/[^)]*\/simgad\/[^)?]+)\?w=(\d+)&h=(\d+)/g)) {
    const w = Number(m[2]);
    const h = Number(m[3]);
    if (w === h && w <= 200) {
      logoUrl ??= m[1]; // 쿼리 제거 → 원본 해상도
    } else if (w * h > bestArea) {
      bestArea = w * h;
      imageUrl = m[1];
    }
  }

  return { headline, description, ctaText, landingUrl, logoUrl, imageUrl };
}

/** \xNN 16진 이스케이프 복원 */
function unescapeHex(s: string): string {
  return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * content.js 미리보기에서 특정 필드 값 추출 (이스케이프/평문 형식 모두).
 * ⚠️ 실측상 필드명 따옴표 유무가 섞여 있다 — adData 최상위는 `destination_url: \x27값\x27`(무따옴표),
 * google_template_data 내부는 `\x27headline\x27: \x27값\x27`(따옴표). 둘 다 잡아야 랜딩 URL 이 확보된다.
 */
function fieldValue(html: string, field: string): string | undefined {
  let m = html.match(new RegExp(`(?:\\\\x27|["'])?${field}(?:\\\\x27|["'])?\\s*:\\s*\\\\x27(.*?)\\\\x27`));
  if (!m) m = html.match(new RegExp(`["']?${field}["']?\\s*:\\s*["']([^"']+)["']`));
  return m?.[1] ? unescapeHex(m[1]).trim() : undefined;
}

/**
 * 랜딩 URL 추출. destination_url(전체 클릭연결) 우선, 없으면 visible_url(전체 URL 또는 도메인).
 * 도메인만 있으면 https 를 붙여 반환한다. landing_domain 은 핸들러가 landingDomain() 으로 계산.
 */
function extractLandingUrl(html: string): string | undefined {
  const dest = fieldValue(html, 'destination_url');
  if (dest && /^https?:\/\//i.test(dest)) return dest;
  const visible = fieldValue(html, 'visible_url');
  if (visible) {
    if (/^https?:\/\//i.test(visible)) return visible;
    if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(visible)) return `https://${visible}`;
  }
  return undefined;
}

/**
 * 전송 계층 — Google 은 Node(undici/https)의 TLS 시그니처를 차단하므로 curl 로 호출한다.
 * 테스트에서 주입 가능.
 */
export interface CrawlTransport {
  rpc(rpcPath: string, reqBody: string): Promise<string>;
  get(url: string): Promise<string>;
}

// 대량 크롤 시 Google 봇 차단을 늦추기 위한 요청 간 지연(throttle). 단건 수집엔 영향 미미.
const THROTTLE_MS = Number(process.env.CRAWL_THROTTLE_MS ?? 500);
function jitterDelay(): Promise<void> {
  const ms = THROTTLE_MS + Math.floor(Math.random() * THROTTLE_MS);
  return new Promise((r) => setTimeout(r, ms));
}

const curlTransport: CrawlTransport = {
  async rpc(rpcPath, reqBody) {
    await jitterDelay();
    const { stdout } = await execFileAsync(
      'curl',
      [
        '-s', '--max-time', '25', `${BASE}/${rpcPath}?authuser=0`,
        '-H', 'content-type: application/x-www-form-urlencoded;charset=UTF-8',
        '-H', `user-agent: ${UA}`,
        '-H', 'origin: https://adstransparency.google.com',
        '-H', 'referer: https://adstransparency.google.com/',
        '--data-urlencode', `f.req=${reqBody}`,
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    return stdout;
  },
  async get(url) {
    await jitterDelay();
    const { stdout } = await execFileAsync('curl', ['-s', '--max-time', '25', url, '-H', `user-agent: ${UA}`], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  },
};

/**
 * Google 광고 투명성 센터 직접 크롤링 어댑터 (SerpApi 대체, 무료).
 * - listAds: SearchService/SearchCreatives (페이지네이션)
 * - getAdDetail: LookupService/GetCreativeById → 미리보기 content.js 에서 YouTube ID 추출
 * ⚠️ 비공식 내부 RPC — 형식 변경 시 조용히 깨질 수 있음. 롤백은 ADS_SOURCE=serpapi.
 * 제한: 랜딩 URL 미제공(콘텐츠에서 추출 불가), 도메인 검색 미지원(회사명 검색 사용).
 */
export class TransparencyCrawlAdsSource implements AdsSource {
  readonly name = 'transparency-crawl';
  private readonly t: CrawlTransport;

  constructor(transport: CrawlTransport = curlTransport) {
    this.t = transport;
  }

  private parse(raw: string, context: string): Json {
    try {
      return JSON.parse(raw) as Json;
    } catch {
      throw new Error(`투명성 센터 크롤 응답 파싱 실패 (${context}) — 형식 변경/차단 가능성`);
    }
  }

  async listAds(
    p: ListAdsParams,
  ): Promise<{ items: AdListItem[]; nextPageToken?: string; apiCalls: number }> {
    const req: Json = {
      2: p.num ?? 40,
      3: { 12: { 1: '', 2: true }, 13: { 1: [p.advertiserId] } },
      7: { 1: 1, 2: 0, 3: toGoogleRegion(p.region) },
    };
    if (p.pageToken) req['4'] = p.pageToken;

    const json = this.parse(await this.t.rpc('SearchService/SearchCreatives', JSON.stringify(req)), 'listAds');
    const rows = (json['1'] as Json[] | undefined) ?? [];
    const items: AdListItem[] = rows
      .map((r) => {
        const first = unixToIso((r['6'] as Json | undefined)?.['1']);
        const last = unixToIso((r['7'] as Json | undefined)?.['1']);
        return {
          creativeId: typeof r['2'] === 'string' ? r['2'] : '',
          advertiserId: typeof r['1'] === 'string' ? r['1'] : p.advertiserId,
          format: FORMAT[Number(r['4'])] ?? 'text',
          firstShown: first,
          lastShown: last,
          daysShown: daysBetween(first, last),
        };
      })
      .filter((i) => i.creativeId);

    const nextPageToken = typeof json['2'] === 'string' ? json['2'] : undefined;
    return { items, nextPageToken, apiCalls: 0 }; // 크롤은 SerpApi 쿼터 미소모
  }

  async getAdDetail(p: GetAdDetailParams): Promise<{ detail: AdDetail; apiCalls: number }> {
    const req: Json = { 1: p.advertiserId, 2: p.creativeId, 5: { 1: 1, 2: 0, 3: 2410 } };
    const json = this.parse(await this.t.rpc('LookupService/GetCreativeById', JSON.stringify(req)), 'getAdDetail');

    const variations = ((json['1'] as Json | undefined)?.['5'] as Json[] | undefined) ?? [];

    let videoUrl: string | undefined;
    // 이미지 광고: 응답에 <img src> 직접 포함 → 미리보기 fetch 없이 추출
    let imageUrl: string | undefined = imageFromVariations(variations);
    let landingUrl: string | undefined;
    let headline: string | undefined;
    let description: string | undefined;
    let ctaText: string | undefined;
    let logoUrl: string | undefined;
    const varDetails: AdVariationDetail[] = [];

    // 대안(variation)별 미리보기 content.js 를 순회하며 각자의 사이즈·구성요소를 추출한다.
    // - 비디오: 대안이 대부분 동일 영상의 사이즈 변형이라 문구 확보 시 조기 중단(요청 절약, 기존 동작).
    // - 이미지·텍스트: 대안마다 문구·CTA·사이즈가 다르므로 **전부** 수집(최대 6개).
    const isVideo = p.format === 'video';
    const urls = previewUrls(variations).slice(0, isVideo ? 3 : 6);
    for (const [idx, previewUrl] of urls.entries()) {
      try {
        const html = await this.t.get(previewUrl);
        const ytId = extractYouTubeId(html);
        if (ytId && !videoUrl) videoUrl = `https://www.youtube.com/embed/${ytId}`;

        // 대안별 구성요소 — adData JSON 우선, 없으면 HTML 마크업 템플릿 파서
        const t = componentsFromHtmlTemplate(html);
        const v: AdVariationDetail = {
          idx,
          headline: fieldValue(html, 'headline') ?? fieldValue(html, 'longHeadline') ?? t.headline,
          description: fieldValue(html, 'description') ?? fieldValue(html, 'body_text') ?? t.description,
          ctaText: fieldValue(html, 'callToActionText') ?? t.ctaText,
          logoUrl: extractLogo(html) ?? t.logoUrl,
          imageUrl: t.imageUrl,
          landingUrl: extractLandingUrl(html) ?? t.landingUrl,
        };
        // 광고 단위 크기 — previewMetadata 실측값
        const size = html.match(/"width"\s*:\s*(\d+)\s*,\s*"height"\s*:\s*(\d+)/);
        if (size) {
          v.width = Number(size[1]);
          v.height = Number(size[2]);
        }
        varDetails.push(v);

        // 광고 대표값 = 처음 확보된 값 (목록 카드·검색용)
        headline ??= v.headline;
        description ??= v.description;
        ctaText ??= v.ctaText;
        logoUrl ??= v.logoUrl;
        landingUrl ??= v.landingUrl;
        imageUrl ??= v.imageUrl;
        if (!imageUrl) imageUrl = extractImageUrl(html); // 비디오 discover 배너 폴백

        if (isVideo && (headline || description)) break;
      } catch {
        // 개별 미리보기 실패는 상세 저장을 막지 않는다 (다음 variation 시도)
      }
    }

    return {
      detail: {
        creativeId: p.creativeId,
        videoUrl,
        imageUrl,
        landingUrl,
        headline,
        description,
        ctaText,
        logoUrl,
        variations: varDetails.length ? varDetails : undefined,
        raw: json,
      },
      apiCalls: 0,
    };
  }

  async searchAdvertisersByDomain(
    _p: SearchAdvertisersParams,
  ): Promise<{ candidates: AdvertiserCandidate[]; apiCalls: number }> {
    // 크롤 소스는 도메인 검색을 지원하지 않는다. 회사명 검색(SearchSuggestions)을 사용한다.
    throw new Error('크롤 소스는 도메인 검색을 지원하지 않습니다. 회사명 검색을 사용하세요.');
  }
}
