import { GoogleTransparencyAdvertiserSearch } from './googleTransparency.js';
import type { AdvertiserSearch } from './types.js';

/** 광고주 이름 검색 어댑터 생성 (현재 Google 투명성 자동완성). */
export function createAdvertiserSearch(fetchImpl?: typeof fetch): AdvertiserSearch {
  return new GoogleTransparencyAdvertiserSearch(fetchImpl);
}
