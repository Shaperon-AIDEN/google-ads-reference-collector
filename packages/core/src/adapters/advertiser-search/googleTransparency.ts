import type { AdvertiserSearch, AdvertiserSuggestion } from './types.js';

const RPC_URL =
  'https://adstransparency.google.com/anji/_/rpc/SearchService/SearchSuggestions?authuser=0';

type Json = Record<string, unknown>;

function toInt(v: unknown): number | undefined {
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  if (typeof v === 'number') return v;
  return undefined;
}

/**
 * Google 광고 투명성 센터의 광고주 자동완성(SearchSuggestions) 어댑터.
 * 회사명 → 광고주 후보(id·이름·지역·광고 수). SerpApi 쿼터를 쓰지 않는다.
 *
 * ⚠️ 비공식 내부 RPC 다. 응답 구조는 필드 번호 기반(protobuf JSON)이며 Google 변경 시
 * 깨질 수 있다 — 매핑을 이 파일에 격리했다. 요청: f.req={"1":<query>,"2":<limit>}.
 * 응답: { "1": [ { "1": { "1":이름, "2":advertiserId, "3":지역, "4":{"2":{"1":low,"2":high}} } } ] }
 */
export class GoogleTransparencyAdvertiserSearch implements AdvertiserSearch {
  readonly name = 'google-transparency';
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async searchByName(query: string, opts: { limit?: number } = {}): Promise<AdvertiserSuggestion[]> {
    const q = query.trim();
    if (!q) return [];
    const limit = opts.limit ?? 10;

    const body = new URLSearchParams();
    body.set('f.req', JSON.stringify({ 1: q, 2: limit }));

    const res = await this.fetchImpl(RPC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        // 브라우저 유래 헤더가 없으면 Google 이 429 로 차단한다.
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        origin: 'https://adstransparency.google.com',
        referer: 'https://adstransparency.google.com/',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`광고주 검색 실패 (${res.status})`);
    }
    const json = (await res.json()) as Json;
    const list = (json['1'] as Json[] | undefined) ?? [];

    const out: AdvertiserSuggestion[] = [];
    for (const entry of list) {
      const a = entry['1'] as Json | undefined;
      if (!a) continue;
      const advertiserId = typeof a['2'] === 'string' ? a['2'] : '';
      if (!advertiserId) continue;
      const count = ((a['4'] as Json | undefined)?.['2'] as Json | undefined) ?? {};
      out.push({
        advertiserId,
        advertiser: typeof a['1'] === 'string' ? a['1'] : advertiserId,
        region: typeof a['3'] === 'string' ? a['3'] : undefined,
        adCountLow: toInt(count['1']),
        adCountHigh: toInt(count['2']),
      });
    }
    return out;
  }
}
