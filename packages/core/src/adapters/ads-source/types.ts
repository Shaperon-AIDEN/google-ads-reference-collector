import type { AdFormat } from '../../domain/models.js';

/**
 * 목록 엔드포인트(google_ads_transparency_center) 결과 항목.
 * 실측 결과 format·게재일·게재일수는 목록에만 존재하므로 여기서 모두 확보한다.
 */
export interface AdListItem {
  creativeId: string; // ad_creative_id
  advertiserId: string;
  advertiser?: string;
  format: AdFormat;
  firstShown?: string; // ISO date (응답의 Unix epoch → 변환)
  lastShown?: string; // ISO date
  daysShown?: number; // total_days_shown
  detailsLink?: string; // details_link (투명성 센터 원본)
}

/**
 * 상세 엔드포인트(google_ads_transparency_center_ad_details) 결과.
 * 실측 결과 영상·랜딩·헤드라인만 제공하며 format/dates 는 없다(목록에서 가져옴).
 */
export interface AdDetail {
  creativeId: string;
  videoUrl?: string; // video_link (youtube embed URL 등)
  landingUrl?: string; // visible_link
  headline?: string;
  channelName?: string;
  raw: unknown; // 원본 응답 verbatim → ads.raw (jsonb)
}

export interface ListAdsParams {
  advertiserId: string;
  region?: string;
  pageToken?: string;
  num?: number;
}

export interface GetAdDetailParams {
  advertiserId: string;
  creativeId: string;
}

/**
 * 광고 데이터 소스 어댑터. SerpApi 를 1차 구현으로 두되, 인터페이스를 분리해
 * SearchApi 등으로 교체·병행할 수 있게 한다. 모든 메서드는 apiCalls 를 반환해
 * 쿼터 가드가 실제 사용량을 collection_runs 에 누적하도록 한다.
 */
export interface AdsSource {
  readonly name: string;
  listAds(
    p: ListAdsParams,
  ): Promise<{ items: AdListItem[]; nextPageToken?: string; apiCalls: number }>;
  getAdDetail(p: GetAdDetailParams): Promise<{ detail: AdDetail; apiCalls: number }>;
}
