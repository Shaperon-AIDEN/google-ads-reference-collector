import { describe, expect, it, vi } from 'vitest';
import { SerpApiAdsSource } from '../src/adapters/ads-source/serpapi.js';

function mockFetch(json: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

describe('searchAdvertisersByDomain', () => {
  it('도메인 검색 결과를 advertiser_id 기준으로 묶어 후보 목록 반환', async () => {
    // 실측(tesla.com) 형태: 한 도메인에 본사+지사 등 여러 광고주
    const fetchImpl = mockFetch({
      ad_creatives: [
        { advertiser_id: 'AR_TESLA', advertiser: 'Tesla Inc.', ad_creative_id: 'C1', format: 'video' },
        { advertiser_id: 'AR_TESLA', advertiser: 'Tesla Inc.', ad_creative_id: 'C2', format: 'image', image: 'https://img/c2.jpg' },
        { advertiser_id: 'AR_TW', advertiser: '台灣特斯拉', ad_creative_id: 'C3', format: 'video' },
        { advertiser: '이름만', ad_creative_id: 'C4' }, // advertiser_id 없음 → 제외
      ],
    });
    const src = new SerpApiAdsSource({ apiKey: 'k', fetchImpl });

    const { candidates, apiCalls } = await src.searchAdvertisersByDomain({ domain: 'tesla.com' });

    expect(apiCalls).toBe(1);
    expect(candidates).toHaveLength(2); // 광고주 2곳으로 집계
    // 광고 수 많은 순 정렬 → Tesla Inc.(2건)가 앞
    expect(candidates[0]).toMatchObject({ advertiserId: 'AR_TESLA', advertiser: 'Tesla Inc.', adCount: 2 });
    expect(candidates[0]!.sampleThumbnail).toBe('https://img/c2.jpg'); // 첫 이미지 샘플
    expect(candidates[1]).toMatchObject({ advertiserId: 'AR_TW', adCount: 1 });
  });

  it('결과 없음(error)이면 예외', async () => {
    const src = new SerpApiAdsSource({ apiKey: 'k', fetchImpl: mockFetch({ error: 'no results' }) });
    await expect(src.searchAdvertisersByDomain({ domain: 'nope.example' })).rejects.toThrow(/SerpApi 오류/);
  });
});
