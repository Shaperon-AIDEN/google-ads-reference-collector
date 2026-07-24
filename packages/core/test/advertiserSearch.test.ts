import { describe, expect, it, vi } from 'vitest';
import { GoogleTransparencyAdvertiserSearch } from '../src/adapters/advertiser-search/googleTransparency.js';

/** 응답 원문(JSON 문자열)을 돌려주는 가짜 transport */
function transport(json: unknown) {
  return vi.fn(async () => JSON.stringify(json));
}

describe('GoogleTransparencyAdvertiserSearch', () => {
  it('실제 응답 구조(드래프터)를 후보로 매핑', async () => {
    const payload = {
      '1': [
        { '1': { '1': '주식회사 드래프터', '2': 'AR08318816061340254209', '3': 'KR', '4': { '2': { '1': '600', '2': '700' } } } },
        { '1': { '1': '주식회사 드래프터', '2': 'AR16035993894130810881', '3': 'KR', '4': { '2': { '1': '400', '2': '500' } } } },
        { '1': { '1': '이름만', '4': {} } }, // advertiser_id 없음 → 제외
      ],
    };
    const search = new GoogleTransparencyAdvertiserSearch(transport(payload));
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
    const search = new GoogleTransparencyAdvertiserSearch(transport({}));
    expect(await search.searchByName('없는브랜드')).toEqual([]);
  });

  it('빈 쿼리는 호출 없이 빈 배열', async () => {
    const spy = transport({});
    const search = new GoogleTransparencyAdvertiserSearch(spy);
    expect(await search.searchByName('   ')).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('차단(HTML 응답) 시 안내 예외', async () => {
    const search = new GoogleTransparencyAdvertiserSearch(vi.fn(async () => '<html>error</html>'));
    await expect(search.searchByName('삼성')).rejects.toThrow(/파싱할 수 없습니다/);
  });
});
