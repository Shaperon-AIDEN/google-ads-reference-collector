import { describe, expect, it, vi } from 'vitest';
import { SerpApiAdsSource } from '../src/adapters/ads-source/serpapi.js';

function mockFetch(json: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

describe('SerpApiAdsSource (실제 응답 스키마 기준)', () => {
  it('listAds 는 ad_creative_id·Unix 게재일·total_days_shown 을 매핑', async () => {
    // 실측 응답(Tesla) 형태 재현
    const fetchImpl = mockFetch({
      ad_creatives: [
        {
          advertiser_id: 'AR17828074650563772417',
          advertiser: 'Tesla Inc.',
          ad_creative_id: 'CR18431297936794058753',
          format: 'video',
          first_shown: 1783949267,
          last_shown: 1784850568,
          total_days_shown: 11,
          details_link: 'https://adstransparency.google.com/advertiser/AR.../creative/CR...',
        },
        { format: 'image' }, // ad_creative_id 없음 → 제외
      ],
      serpapi_pagination: { next_page_token: 'TOK' },
    });
    const src = new SerpApiAdsSource({ apiKey: 'k', fetchImpl });

    const res = await src.listAds({ advertiserId: 'AR17828074650563772417', region: 'KR' });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      creativeId: 'CR18431297936794058753',
      advertiser: 'Tesla Inc.',
      format: 'video',
      firstShown: '2026-07-13', // 1783949267 → ISO date
      lastShown: '2026-07-23',
      daysShown: 11,
    });
    expect(res.nextPageToken).toBe('TOK');
    expect(res.apiCalls).toBe(1);
  });

  it('getAdDetail 은 상세 ad_creatives[0] 의 video_link·visible_link 를 매핑하고 raw 보존', async () => {
    const payload = {
      ad_creatives: [
        {
          video_link: 'https://www.youtube.com/embed/TOnJMLfOZCs',
          headline: 'Mehr Solarstrom nutzen',
          call_to_action: 'GET_QUOTE',
          visible_link: 'https://www.tesla.com/de_de/powerwall/Energy/Powerwall3P',
          channel_name: 'Tesla',
        },
      ],
    };
    const src = new SerpApiAdsSource({ apiKey: 'k', fetchImpl: mockFetch(payload) });

    const { detail, apiCalls } = await src.getAdDetail({
      advertiserId: 'AR17828074650563772417',
      creativeId: 'CR18431297936794058753',
    });
    expect(detail.creativeId).toBe('CR18431297936794058753');
    expect(detail.videoUrl).toBe('https://www.youtube.com/embed/TOnJMLfOZCs');
    expect(detail.landingUrl).toBe('https://www.tesla.com/de_de/powerwall/Energy/Powerwall3P');
    expect(detail.headline).toBe('Mehr Solarstrom nutzen');
    expect(detail.channelName).toBe('Tesla');
    expect(detail.raw).toEqual(payload); // 원본 verbatim
    expect(apiCalls).toBe(1);
  });

  it('SerpApi error 필드는 예외로 변환 (목록)', async () => {
    const src = new SerpApiAdsSource({
      apiKey: 'k',
      fetchImpl: mockFetch({ error: "hasn't returned any results" }),
    });
    await expect(src.listAds({ advertiserId: 'AR_NONE' })).rejects.toThrow(/SerpApi 오류/);
  });

  it('상세 "결과 없음" 은 예외 대신 빈 상세 반환 (재시도 방지)', async () => {
    const src = new SerpApiAdsSource({
      apiKey: 'k',
      fetchImpl: mockFetch({ error: "Ad Details hasn't returned any results for this query." }),
    });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR_GONE' });
    expect(detail.creativeId).toBe('CR_GONE');
    expect(detail.videoUrl).toBeUndefined();
    expect(detail.raw).toMatchObject({ detailUnavailable: true });
  });

  it('apiKey 누락 시 생성자에서 예외', () => {
    expect(() => new SerpApiAdsSource({ apiKey: '' })).toThrow(/SERPAPI_KEY/);
  });
});
