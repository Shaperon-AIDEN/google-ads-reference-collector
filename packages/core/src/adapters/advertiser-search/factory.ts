import { GoogleTransparencyAdvertiserSearch, type SuggestTransport } from './googleTransparency.js';
import type { AdvertiserSearch } from './types.js';

/** 광고주 이름 검색 어댑터 생성 (Google 투명성 자동완성, curl 전송). */
export function createAdvertiserSearch(transport?: SuggestTransport): AdvertiserSearch {
  return new GoogleTransparencyAdvertiserSearch(transport);
}
