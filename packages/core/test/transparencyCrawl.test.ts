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

  it('getAdDetail: 광고 구성요소(headline/description/ctaText) 추출 — 완성 광고 재현용', async () => {
    const rpc = vi.fn(async () => JSON.stringify({ '1': { '5': [{ '1': { '4': 'https://p/x.js' } }] } }));
    const get = vi.fn(
      async () =>
        'google_template_data: {\\x27adData\\x27: [{\\x27headline\\x27: \\x27일반 치약의 20배 효과\\x27,' +
        '\\x27description\\x27: \\x27온 가족 칫솔 닿는 치약 쓰시나요?\\x27,\\x27callToActionText\\x27: \\x27열기\\x27}]}',
    );
    const src = new TransparencyCrawlAdsSource({ rpc, get });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR' });
    expect(detail.headline).toBe('일반 치약의 20배 효과');
    expect(detail.description).toBe('온 가족 칫솔 닿는 치약 쓰시나요?');
    expect(detail.ctaText).toBe('열기');
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

  // 실측 회귀: 이미지 광고는 variation[0] 이 정적 img HTML(['3']['2'])이라 ['1']['4'] 미리보기 URL 이
  // 없고, 미리보기는 뒤쪽 variation 에만 있다. variation[0] 만 보면 문구·CTA·랜딩이 통째로 누락됐다.
  it('getAdDetail: 이미지 광고 — 뒤쪽 variation 의 미리보기에서 문구·CTA·랜딩 확보', async () => {
    const rpc = vi.fn(async () =>
      JSON.stringify({
        '1': {
          '5': [
            { '3': { '2': '<img src="https://tpc.googlesyndication.com/archive/simgad/AD" width="1920" height="1005">' } },
            { '1': { '4': 'https://p/content.js' } },
          ],
        },
      }),
    );
    const get = vi.fn(async () =>
      [
        'destination_url: \\x27https://dusk.example/lp\\x27',
        '\\x27headline\\x27: \\x27동양인 잇몸이 유독 약한 이유\\x27',
        '\\x27description\\x27: \\x27한 방울이면 차오릅니다\\x27',
        '\\x27callToActionText\\x27: \\x27열기\\x27',
        '\\x27logo\\x27: \\x27data:image/png;base64,iVBORw0KGgo=\\x27',
      ].join(','),
    );
    const src = new TransparencyCrawlAdsSource({ rpc, get });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR_IMG' });
    expect(detail.imageUrl).toBe('https://tpc.googlesyndication.com/archive/simgad/AD'); // 응답 직접 추출 유지
    expect(detail.headline).toBe('동양인 잇몸이 유독 약한 이유');
    expect(detail.description).toBe('한 방울이면 차오릅니다');
    expect(detail.ctaText).toBe('열기');
    expect(detail.logoUrl).toBe('data:image/png;base64,iVBORw0KGgo='); // 브랜드 로고(데이터 URI)
    expect(detail.landingUrl).toBe('https://dusk.example/lp');
    expect(get).toHaveBeenCalledTimes(1); // 문구 확보 즉시 중단 → 추가 요청 없음
  });

  it('getAdDetail: 첫 variation 에 문구 없으면 다음 variation 미리보기까지 시도(최대 3)', async () => {
    const rpc = vi.fn(async () =>
      JSON.stringify({
        '1': { '5': [{ '1': { '4': 'https://p/a.js' } }, { '1': { '4': 'https://p/b.js' } }] },
      }),
    );
    const get = vi
      .fn()
      .mockResolvedValueOnce('빈 레이아웃 — 문구 없음')
      .mockResolvedValueOnce('\\x27headline\\x27: \\x27두번째 레이아웃 문구\\x27');
    const src = new TransparencyCrawlAdsSource({ rpc, get });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR' });
    expect(detail.headline).toBe('두번째 레이아웃 문구');
    expect(get).toHaveBeenCalledTimes(2);
  });

  // 실측 회귀: adData JSON 이 없는 HTML 마크업 템플릿(creativeType 46 이미지 레이아웃).
  // 문구는 title/body 클래스 <a>, CTA 는 btnClk 앵커, 랜딩은 adurl=, 로고는 정사각 소형 bg 이미지.
  it('getAdDetail: HTML 마크업 템플릿에서 문구·CTA·랜딩·로고 추출 (adData 없음)', async () => {
    const rpc = vi.fn(async () =>
      JSON.stringify({ '1': { '5': [{ '1': { '4': 'https://p/content.js' } }] } }),
    );
    const get = vi.fn(
      async () =>
        '.ns-x-e-10{background-image:url(https://tpc.googlesyndication.com/simgad/BANNER?w\\x3d400\\x26h\\x3d209\\x26tw\\x3d1)}' +
        '.ns-x-e-11{background-image:url(https://tpc.googlesyndication.com/simgad/LOGO?w\\x3d100\\x26h\\x3d100\\x26tw\\x3d1)}' +
        '\\x3cdiv class\\x3d\\x22ns-x-e-12 title milo-font\\x22\\x3e\\x3ca class\\x3d\\x22ns-x-e-13\\x22 href\\x3d\\x22https://g/aclk?adurl\\x3dhttps%3A%2F%2Fparodex.kr%2Fproduct%3Fno%3D13\\x22\\x3e일반 치약의 20배\\x3cbr\\x3e효과\\x3c/a\\x3e\\x3c/div\\x3e' +
        '\\x3cdiv class\\x3d\\x22ns-x-e-15 body\\x22\\x3e\\x3ca class\\x3d\\x22ns-x-e-16\\x22\\x3e온 가족 칫솔 닿는 치약 쓰시나요?\\x3c/a\\x3e\\x3c/div\\x3e' +
        '\\x3ca class\\x3d\\x22ns-x-e-23\\x22 data-asoch-targets\\x3d\\x22ad0,btnClk\\x22\\x3e열기\\x3c/a\\x3e',
    );
    const src = new TransparencyCrawlAdsSource({ rpc, get });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR_HTMLTPL' });
    expect(detail.headline).toBe('일반 치약의 20배 효과'); // <br> → 공백
    expect(detail.description).toBe('온 가족 칫솔 닿는 치약 쓰시나요?');
    expect(detail.ctaText).toBe('열기');
    expect(detail.landingUrl).toBe('https://parodex.kr/product?no=13'); // adurl= 디코드
    expect(detail.logoUrl).toBe('https://tpc.googlesyndication.com/simgad/LOGO'); // 정사각 소형만, 쿼리 제거
  });

  // 대안(variation) 전량 수집 — 이미지·텍스트는 대안마다 문구·사이즈가 다르므로 전부 보존한다.
  it('getAdDetail: 이미지 광고 — 대안별 문구·사이즈를 variations[] 로 전부 수집', async () => {
    const rpc = vi.fn(async () =>
      JSON.stringify({ '1': { '5': [{ '1': { '4': 'https://p/a.js' } }, { '1': { '4': 'https://p/b.js' } }] } }),
    );
    const get = vi
      .fn()
      .mockResolvedValueOnce(
        '\\x27headline\\x27: \\x27대안1 문구\\x27,"previewMetadata":[{"iframeId":"x_v0_300_600_","width":300,"height":600}]',
      )
      .mockResolvedValueOnce(
        '\\x27headline\\x27: \\x27대안2 문구\\x27,"previewMetadata":[{"iframeId":"x_v1_400_667_","width":400,"height":667}]',
      );
    const src = new TransparencyCrawlAdsSource({ rpc, get });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR', format: 'image' });
    expect(detail.variations).toHaveLength(2); // 문구가 있어도 중단하지 않고 전부
    expect(detail.variations![0]).toMatchObject({ idx: 0, headline: '대안1 문구', width: 300, height: 600 });
    expect(detail.variations![1]).toMatchObject({ idx: 1, headline: '대안2 문구', width: 400, height: 667 });
    expect(detail.headline).toBe('대안1 문구'); // 대표값 = 첫 확보값
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('getAdDetail: 비디오는 문구 확보 시 조기 중단 (대안 요청 절약)', async () => {
    const rpc = vi.fn(async () =>
      JSON.stringify({ '1': { '5': [{ '1': { '4': 'https://p/a.js' } }, { '1': { '4': 'https://p/b.js' } }] } }),
    );
    const get = vi.fn(async () => 'ytimg.com/vi/abcdefghijk \\x27headline\\x27: \\x27영상 문구\\x27');
    const src = new TransparencyCrawlAdsSource({ rpc, get });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR', format: 'video' });
    expect(detail.headline).toBe('영상 문구');
    expect(get).toHaveBeenCalledTimes(1); // 첫 미리보기에서 문구 확보 → 중단
  });

  // 실측 회귀: 검색형 텍스트 광고("Single Ad Rendering Service") — adData·마크업 템플릿이 없고
  // AF_dataServiceRequests "361903925" 배열에 [ …null×7, headline, visibleUrl, description ] 로 들어있다.
  it('getAdDetail: 검색형 텍스트 광고 — AF_dataServiceRequests 에서 문구·랜딩 추출', async () => {
    const rpc = vi.fn(async () => JSON.stringify({ '1': { '5': [{ '1': { '4': 'https://p/x.js' } }] } }));
    const get = vi.fn(
      async () =>
        `var AF_dataServiceRequests = {'ds:0' : {id:'xFkH7c',request:[[{"361903925":[null,null,null,null,null,null,null,` +
        `"출퇴근부터 운동까지 함께 해요 - 골전도 이어폰 제대로 시작해요","www.basetune.co.kr/","귀가 편해야 음악도 오래 듣게 되더라구요",null,null,5,{}]}]]}}` +
        `,"previewMetadata":[{"width":380,"height":320}]`,
    );
    const src = new TransparencyCrawlAdsSource({ rpc, get });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR_SEARCH', format: 'text' });
    expect(detail.headline).toBe('출퇴근부터 운동까지 함께 해요 - 골전도 이어폰 제대로 시작해요');
    expect(detail.description).toBe('귀가 편해야 음악도 오래 듣게 되더라구요');
    expect(detail.landingUrl).toBe('https://www.basetune.co.kr/');
    expect(detail.imageUrl).toBeUndefined(); // 이 유형은 크리에이티브 이미지가 원래 없다
    expect(detail.variations![0]).toMatchObject({ width: 380, height: 320 });
  });

  // 실측 회귀: 쇼핑 광고(PLA) — data-p 속성에 [상품이미지, 상품명, 판매자, 플랫폼] JSON.
  // 상품 이미지는 encrypted-tbn*.gstatic.com/shopping?q=tbn:… (쿼리가 식별자라 제거 금지).
  it('getAdDetail: 쇼핑 광고(PLA) — data-p 에서 상품 이미지·상품명 추출', async () => {
    const rpc = vi.fn(async () => JSON.stringify({ '1': { '5': [{ '1': { '4': 'https://p/x.js' } }] } }));
    const get = vi.fn(
      async () =>
        '<c-wiz jsrenderer="dtLcSd" data-p="%.@.[&quot;https://encrypted-tbn1.gstatic.com/shopping?q\\\\u003dtbn:ANd9GcTwmls&quot;,&quot;포디온 코어 Tri-core Balance Dynamics&quot;,&quot;포디온&quot;,&quot;Google&quot;]]" view c-wiz>' +
        ',"previewMetadata":[{"width":300,"height":250}]',
    );
    const src = new TransparencyCrawlAdsSource({ rpc, get });
    const { detail } = await src.getAdDetail({ advertiserId: 'AR1', creativeId: 'CR_PLA', format: 'image' });
    expect(detail.imageUrl).toBe('https://encrypted-tbn1.gstatic.com/shopping?q=tbn:ANd9GcTwmls'); // = 복원
    expect(detail.headline).toBe('포디온 코어 Tri-core Balance Dynamics');
    expect(detail.variations![0]).toMatchObject({ width: 300, height: 250 });
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
