import type { AdFormat } from '../../domain/models.js';
import type {
  AdDetail,
  AdListItem,
  AdsSource,
  GetAdDetailParams,
  ListAdsParams,
} from './types.js';

const SERPAPI_BASE = 'https://serpapi.com/search.json';

/**
 * SerpApi Google Ads Transparency Center 어댑터.
 * 필드 매핑은 실제 API 응답(Tesla advertiser 실측, 2026-07)을 기준으로 확정했다.
 * - 목록:  engine=google_ads_transparency_center → ad_creatives[]
 * - 상세:  engine=google_ads_transparency_center_ad_details → ad_creatives[] (변형)
 * raw 원본은 항상 보존한다.
 */
export interface SerpApiConfig {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

type Json = Record<string, unknown>;

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Unix epoch(초) → ISO 날짜(YYYY-MM-DD). first_shown/last_shown 은 정수로 온다. */
function unixToIsoDate(v: unknown): string | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return new Date(v * 1000).toISOString().slice(0, 10);
}

function normalizeFormat(v: unknown): AdFormat {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (s.includes('video')) return 'video';
  if (s.includes('image')) return 'image';
  return 'text';
}

/**
 * DB 의 ISO 국가 코드(비즈니스 표현)를 SerpApi 의 숫자 geo target region 코드로 매핑.
 * SerpApi 는 "KR" 같은 ISO 코드를 거부하고 숫자 코드(예: 한국 2410, 미국 2840)를 요구한다.
 * 이미 숫자면 그대로 통과, 알 수 없는 값이면 undefined(전 지역) 로 폴백해 하드 실패를 막는다.
 */
const REGION_CODE: Record<string, string> = {
  KR: '2410',
  US: '2840',
  JP: '2392',
  GB: '2826',
  DE: '2276',
  FR: '2250',
};

function toSerpApiRegion(region?: string): string | undefined {
  if (!region) return undefined;
  if (/^\d+$/.test(region)) return region; // 이미 SerpApi 숫자 코드
  return REGION_CODE[region.toUpperCase()];
}

export class SerpApiAdsSource implements AdsSource {
  readonly name = 'serpapi';
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: SerpApiConfig) {
    if (!cfg.apiKey) throw new Error('SERPAPI_KEY 가 필요합니다.');
    this.apiKey = cfg.apiKey;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private async get(params: Record<string, string>): Promise<Json> {
    const url = new URL(SERPAPI_BASE);
    url.searchParams.set('api_key', this.apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await this.fetchImpl(url.toString());
    if (!res.ok) {
      throw new Error(`SerpApi 요청 실패 (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as Json;
    // SerpApi 는 200 으로 응답하며 결과 없음/오류를 error 필드로 전달한다.
    if (typeof json.error === 'string') {
      throw new Error(`SerpApi 오류: ${json.error}`);
    }
    return json;
  }

  async listAds(
    p: ListAdsParams,
  ): Promise<{ items: AdListItem[]; nextPageToken?: string; apiCalls: number }> {
    const params: Record<string, string> = {
      engine: 'google_ads_transparency_center',
      advertiser_id: p.advertiserId,
    };
    const region = toSerpApiRegion(p.region);
    if (region) params.region = region;
    if (p.num) params.num = String(p.num);
    if (p.pageToken) params.next_page_token = p.pageToken;

    const json = await this.get(params);
    const creatives = (json.ad_creatives as Json[] | undefined) ?? [];
    const items: AdListItem[] = creatives.map((c) => ({
      creativeId: asString(c.ad_creative_id) ?? asString(c.creative_id) ?? '',
      advertiserId: asString(c.advertiser_id) ?? p.advertiserId,
      advertiser: asString(c.advertiser),
      format: normalizeFormat(c.format),
      firstShown: unixToIsoDate(c.first_shown),
      lastShown: unixToIsoDate(c.last_shown),
      daysShown: typeof c.total_days_shown === 'number' ? c.total_days_shown : undefined,
      detailsLink: asString(c.details_link),
    }));

    const pagination = (json.serpapi_pagination as Json | undefined) ?? {};
    const nextPageToken = asString(pagination.next_page_token);

    return { items: items.filter((i) => i.creativeId), nextPageToken, apiCalls: 1 };
  }

  async getAdDetail(p: GetAdDetailParams): Promise<{ detail: AdDetail; apiCalls: number }> {
    const json = await this.get({
      engine: 'google_ads_transparency_center_ad_details',
      advertiser_id: p.advertiserId,
      creative_id: p.creativeId,
    });

    // 상세는 ad_creatives 배열(변형)로 온다. 첫 변형을 대표로 사용한다.
    const variations = (json.ad_creatives as Json[] | undefined) ?? [];
    const first = variations[0] ?? {};

    const detail: AdDetail = {
      creativeId: p.creativeId,
      videoUrl: asString(first.video_link),
      landingUrl: asString(first.visible_link),
      headline: asString(first.headline),
      channelName: asString(first.channel_name),
      raw: json,
    };

    return { detail, apiCalls: 1 };
  }
}
