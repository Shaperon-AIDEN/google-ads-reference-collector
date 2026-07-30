import { describe, expect, it, vi } from 'vitest';
import { TransparencyCrawlAdsSource, type CrawlTransport } from '../src/adapters/ads-source/transparencyCrawl.js';

describe('TransparencyCrawlAdsSource', () => {
  it('listAds: SearchCreatives 응답을 매핑 + 페이지네이션 토큰', async () => {
    // 실측 응답 구조 재현 (item: 1=advertiserId, 2=creativeId, 4=format, 6/7=unix dates)
    const rpc = vi.fn(async () =>
      JSON.stringify({
        '1': [
          { '1': 'AR1', '2': 'CR_VID', '4': 3, '6': { '1': '1784000000' }, '7': { '1': '1784864000' } },
          { '1': 'AR1', '2': 'CR_TXT', '4': 1, '6': { '1': '1784000000' }, '7': { '1': '1784086400' } },
          { '1': 'AR1', '4': 3 }, // creativeId 없음 → 제외
        ],
        '2': 'NEXT_PAGE_TOKEN',
      }),
    );
    const transport: CrawlTransport = { rpc, get: vi.fn() };
    const src = new TransparencyCrawlAdsSource(transport);

    const res = await src.listAds({ advertiserId: 'AR1', region: 'KR' });

    expect(res.apiCalls).toBe(0); // SerpApi 쿼터 미소모
    expect(res.nextPageToken).toBe('NEXT_PAGE_TOKEN');
    expect(res.items).toHaveLength(2);
    expect(res.items[0]).toMatchObject({ creativeId: 'CR_VID', format: 'video' });
    expect(res.items[0]!.firstShown).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.items[1]).toMatchObject({ creativeId: 'CR_TXT', format: 'text' });
    // 요청에 advertiser_id 가 배열(3.13.1)로 들어갔는지
    const sentBody = JSON.parse((rpc.mock.calls[0]![1] as string));
    expect(sentBody['3']['13']['1']).toEqual(['AR1']);
    expect(sentBody['7']['3']).toBe(2410); // KR region
  });

  it('listAds: 두 번째 페이지 요청에 pageToken 이 field 4 로 포함', async () => {
    const rpc = vi.fn(async () => JSON.stringify({ '1': [], '2': null }));
    const src = new TransparencyCrawlAdsSource({ rpc, get: vi.fn() });
    await src.listAds({ advertiserId: 'AR1', pageToken: 'TOKEN123' });
    const body = JSON.parse((rpc.mock.calls[0]![1] as string));
    expect(body['4']).toBe('TOKEN123');
  });

  it('getAdDetail: content.js 에서 YouTube ID(URL 형식) + visible_url 랜딩 추출', async () => {
    const rpc = vi.fn(async () =>
      JSON.stringify({ '1': { '5': [{ '1': { '4': 'https://preview.example/content.js?x=1' } }] } }),
    );
    const get = vi.fn(async () =>
      'x https://i.ytimg.com/vi/CC740J4UJxw/hqdefault.jpg y \\x27visible_url\\x27: \\x27https://cellacure.shop/product?a\\x3d1\\x27',
    );
    const src = new TransparencyCrawlAdsSource({ rpc, get });

    const { detail, apiCalls } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR_VID' });
    expect(apiCalls).toBe(0);
    expect(detail.videoUrl).toBe('https://www.youtube.com/embed/CC740J4UJxw');
    expect(detail.landingUrl).toBe('https://cellacure.shop/product?a=1'); // \x3d → =
  });

  it('getAdDetail: video_id 필드 형식(YouTube player media)도 추출', async () => {
    const rpc = vi.fn(async () => JSON.stringify({ '1': { '5': [{ '1': { '4': 'https://p/x.js' } }] } }));
    const get = vi.fn(async () => "layout: \\x27youtube_player_media_mobile\\x27,\\x27video_id\\x27: \\x27-_e5w77ajvk\\x27");
    const src = new TransparencyCrawlAdsSource({ rpc, get });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR' });
    expect(detail.videoUrl).toBe('https://www.youtube.com/embed/-_e5w77ajvk');
  });

  it('getAdDetail: destination_url 우선, visible_url 도메인은 https 보정', async () => {
    const rpc = vi.fn(async () => JSON.stringify({ '1': { '5': [{ '1': { '4': 'https://p/x.js' } }] } }));
    // visible_url 은 도메인만, destination_url 은 전체 URL
    const get = vi.fn(async () =>
      "\\x27visible_url\\x27: \\x27sonusair.kr\\x27,\\x27destination_url\\x27: \\x27https://sonusair.kr/product?a\\x3d1\\x27",
    );
    const src = new TransparencyCrawlAdsSource({ rpc, get });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR' });
    expect(detail.landingUrl).toBe('https://sonusair.kr/product?a=1');
  });

  it('getAdDetail: 실측 형태 — 필드명 무따옴표(destination_url:)도 랜딩·문구 추출', async () => {
    // 실측 content.js: adData 최상위는 필드명 무따옴표, google_template_data 내부는 \x27 로 감쌈
    const rpc = vi.fn(async () => JSON.stringify({ '1': { '5': [{ '1': { '4': 'https://p/x.js' } }] } }));
    const get = vi.fn(
      async () =>
        'var adData = {visible_url: \\x27parodex.kr\\x27,destination_url: \\x27https://parodex.kr/product/detail.html?product_no\\x3d13\\x27,' +
        'google_template_data: {\\x27adData\\x27: [{\\x27headline\\x27: \\x27앰플 세럼 치약\\x27,\\x27thumbnail\\x27: \\x27https://i.ytimg.com/vi/I6J_lQd3Qy0/hqdefault.jpg\\x27}]}};',
    );
    const src = new TransparencyCrawlAdsSource({ rpc, get });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR' });
    expect(detail.landingUrl).toBe('https://parodex.kr/product/detail.html?product_no=13'); // 무따옴표 필드명
    expect(detail.headline).toBe('앰플 세럼 치약');
    expect(detail.videoUrl).toBe('https://www.youtube.com/embed/I6J_lQd3Qy0'); // 썸네일에서 YouTube ID
  });

  it('getAdDetail: destination_url 없고 visible_url 이 도메인만이면 https 보정', async () => {
    const rpc = vi.fn(async () => JSON.stringify({ '1': { '5': [{ '1': { '4': 'https://p/x.js' } }] } }));
    const get = vi.fn(async () => "\\x27visible_url\\x27: \\x27sonusair.kr\\x27");
    const src = new TransparencyCrawlAdsSource({ rpc, get });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR' });
    expect(detail.landingUrl).toBe('https://sonusair.kr');
  });

  it('getAdDetail: 미리보기에 YouTube 없으면 videoUrl 없이 저장', async () => {
    const rpc = vi.fn(async () => JSON.stringify({ '1': { '5': [{ '1': { '4': 'https://p/x.js' } }] } }));
    const get = vi.fn(async () => 'no video here');
    const src = new TransparencyCrawlAdsSource({ rpc, get });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR' });
    expect(detail.videoUrl).toBeUndefined();
  });

  it('getAdDetail: 이미지 광고 — /archive/simgad/ 크리에이티브를 <img> 에서 추출(미리보기 fetch 불필요)', async () => {
    const rpc = vi.fn(async () =>
      JSON.stringify({
        '1': { '5': [{ '3': { '2': '<img src="https://tpc.googlesyndication.com/archive/simgad/123" width="696" height="450">' } }] },
      }),
    );
    const src = new TransparencyCrawlAdsSource({ rpc, get: vi.fn() });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR_IMG' });
    expect(detail.imageUrl).toBe('https://tpc.googlesyndication.com/archive/simgad/123');
  });

  it('getAdDetail: <img> 여러 개면 정사각 로고 건너뛰고 배너 크리에이티브 선택', async () => {
    const rpc = vi.fn(async () =>
      JSON.stringify({
        '1': {
          '5': [
            {
              '3': {
                '2':
                  '<img src="https://tpc.googlesyndication.com/simgad/LOGO" width="2084" height="2084">' + // 대형 로고
                  '<img src="https://tpc.googlesyndication.com/archive/simgad/AD" width="696" height="450">',
              },
            },
          ],
        },
      }),
    );
    const src = new TransparencyCrawlAdsSource({ rpc, get: vi.fn() });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR_IMG' });
    expect(detail.imageUrl).toBe('https://tpc.googlesyndication.com/archive/simgad/AD'); // 대형이어도 로고는 제외
  });

  it('getAdDetail: AdChoices ⓘ 아이콘(24x24, /archive/simgad/)은 건너뛰고 실제 크리에이티브 선택', async () => {
    const rpc = vi.fn(async () =>
      JSON.stringify({
        '1': {
          '5': [
            {
              '3': {
                '2':
                  '<img src="https://tpc.googlesyndication.com/archive/simgad/ICON" width="24" height="24">' + // ⓘ
                  '<img src="https://tpc.googlesyndication.com/archive/simgad/AD" width="600" height="500">',
              },
            },
          ],
        },
      }),
    );
    const src = new TransparencyCrawlAdsSource({ rpc, get: vi.fn() });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR' });
    expect(detail.imageUrl).toBe('https://tpc.googlesyndication.com/archive/simgad/AD');
  });

  it('getAdDetail: 아이콘(24x24)만 있으면 imageUrl 없음', async () => {
    const rpc = vi.fn(async () =>
      JSON.stringify({
        '1': { '5': [{ '3': { '2': '<img src="https://tpc.googlesyndication.com/archive/simgad/ICON" width="24" height="24">' } }] },
      }),
    );
    const src = new TransparencyCrawlAdsSource({ rpc, get: vi.fn() });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR' });
    expect(detail.imageUrl).toBeUndefined();
  });

  it('getAdDetail: 로고(/simgad/ archive없음)만 있으면 크기 무관 imageUrl 없음', async () => {
    const rpc = vi.fn(async () =>
      JSON.stringify({
        '1': { '5': [{ '3': { '2': '<img src="https://tpc.googlesyndication.com/simgad/LOGO" width="2084" height="2084">' } }] },
      }),
    );
    const src = new TransparencyCrawlAdsSource({ rpc, get: vi.fn() });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR_IMG' });
    expect(detail.imageUrl).toBeUndefined();
  });

  it('getAdDetail: /pagead/ HTML 자산은 이미지로 오인하지 않음', async () => {
    const rpc = vi.fn(async () =>
      JSON.stringify({
        '1': { '5': [{ '3': { '2': '<img src="https://tpc.googlesyndication.com/pagead/gadgets/discover_ads.html" width="600" height="500">' } }] },
      }),
    );
    const src = new TransparencyCrawlAdsSource({ rpc, get: vi.fn() });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR_HTML' });
    expect(detail.imageUrl).toBeUndefined();
  });

  it('도메인 검색은 미지원(예외)', async () => {
    const src = new TransparencyCrawlAdsSource({ rpc: vi.fn(), get: vi.fn() });
    await expect(src.searchAdvertisersByDomain({ domain: 'x.com' })).rejects.toThrow(/회사명 검색/);
  });

  it('파싱 실패(차단 HTML)는 안내 예외', async () => {
    const src = new TransparencyCrawlAdsSource({ rpc: vi.fn(async () => '<html>blocked</html>'), get: vi.fn() });
    await expect(src.listAds({ advertiserId: 'AR1' })).rejects.toThrow(/파싱 실패/);
  });
});
