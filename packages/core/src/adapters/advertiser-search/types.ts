/** 광고주 이름 자동완성 후보 (온보딩 이름 검색용) */
export interface AdvertiserSuggestion {
  advertiserId: string;
  advertiser: string; // 광고주 표시명
  region?: string; // 주 게재 지역 (예: KR)
  adCountLow?: number; // 광고 수 범위 하한 (근사)
  adCountHigh?: number; // 광고 수 범위 상한 (근사)
}

/**
 * 광고주 이름 검색. Google 투명성 센터의 자동완성(SearchSuggestions) 기반.
 * SerpApi 는 회사명 검색을 지원하지 않으므로 별도 소스로 둔다.
 */
export interface AdvertiserSearch {
  readonly name: string;
  searchByName(query: string, opts?: { limit?: number }): Promise<AdvertiserSuggestion[]>;
}
