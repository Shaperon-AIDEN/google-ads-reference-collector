import { describe, expect, it, vi } from 'vitest';
import { GoogleTransparencyAdvertiserSearch } from '../src/adapters/advertiser-search/googleTransparency.js';

function mockFetch(json: unknown, ok = true): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(json), { status: ok ? 200 : 500 }),
  ) as unknown as typeof fetch;
}

describe('GoogleTransparencyAdvertiserSearch', () => {
  it('실제 응답 구조(드래프터)를 후보로 매핑', async () => {
    // 실측 응답 형태 재현
    const payload = {
      '1': [
        { '1': { '1': '주식회사 드래프터', '2': 'AR08318816061340254209', '3': 'KR', '4': { '2': { '1': '600', '2': '700' } } } },
        { '1': { '1': '주식회사 드래프터', '2': 'AR16035993894130810881', '3': 'KR', '4': { '2': { '1': '400', '2': '500' } } } },
        { '1': { '1': '이름만', '4': {} } }, // advertiser_id 없음 → 제외
      ],
    };
    const search = new GoogleTransparencyAdvertiserSearch(mockFetch(payload));
    const res = await search.searchByName('드래프터');

    expect(res).toHaveLength(2);
    expect(res[0]).toEqual({
      advertiserId: 'AR08318816061340254209',
      advertiser: '주식회사 드래프터',
      region: 'KR',
      adCountLow: 600,
      adCountHigh: 700,
    });
    expect(res[1]!.advertiserId).toBe('AR16035993894130810881');
  });

  it('빈 응답이면 빈 배열', async () => {
    const search = new GoogleTransparencyAdvertiserSearch(mockFetch({}));
    expect(await search.searchByName('없는브랜드')).toEqual([]);
  });

  it('빈 쿼리는 호출 없이 빈 배열', async () => {
    const spy = mockFetch({});
    const search = new GoogleTransparencyAdvertiserSearch(spy);
    expect(await search.searchByName('   ')).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
