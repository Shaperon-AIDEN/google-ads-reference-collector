import { createAdvertiserSearch, type AdvertiserSearch } from '@adref/core';

/** 서버 전용 광고주 이름 검색 (Google 투명성 자동완성). */
export function advertiserSearch(): AdvertiserSearch {
  return createAdvertiserSearch();
}
