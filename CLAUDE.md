# CLAUDE.md — 프로젝트 작업 지침

구글 광고 레퍼런스 수집 시스템 저장소에서 작업할 때 따르는 규칙.

## 🔴 문서 동기화 규칙 (필수)

**각 단계별로 개발이 진행되거나 변경사항이 발생하면, `PROJECT.md`, `TODO.md`, `CLAUDE.md`를 항상 업데이트한다.**

- **PROJECT.md** — 설계·아키텍처·기술 스택·일정·비용 등 변경 시 반영 (프로젝트 단일 기준 문서)
- **TODO.md** — 작업 착수/완료/변경 시 체크박스 상태(`[ ]`/`[~]`/`[x]`) 갱신, 신규 작업 추가
- **CLAUDE.md** — 작업 규칙·컨벤션·의사결정이 바뀌면 반영

### 언제 업데이트하나
- Phase(단계) 진입·완료 시
- 기능 구현/수정/삭제 시
- 아키텍처·기술 스택·일정·비용·리스크 변경 시
- 새로운 결정(트레이드오프, 컨벤션)이 확정될 때

### 방식
- 코드 변경과 **같은 커밋/PR**에서 문서도 함께 업데이트 (문서 드리프트 방지)
- TODO 완료 항목은 `[x]`로 표시하고 삭제하지 않는다 (진행 이력 보존)
- 변경이 설계에 영향을 주면 PROJECT.md의 해당 장(章)을 직접 수정

## 개발 진행 방식

**로컬 우선 구현 → 전체 기능 테스트 완료 → Azure 배포** (PROJECT.md 0장 참조)

- 🚧 **게이트:** Phase 3(로컬 통합 테스트) 전체 기능 테스트 통과 전에는 Azure 리소스를 프로비저닝하지 않는다.
- 로컬 개발은 Azure 동등 환경(Functions Core Tools, Azurite, 로컬 PostgreSQL/Docker)에서 진행한다.
- 클라우드 종속을 최소화한다: 큐·스토리지·DB 엔드포인트는 환경 변수/설정으로 주입해 로컬↔Azure 전환 시 코드 변경 없이 설정만 교체.

## 기술 스택 (확정)

- 언어/런타임: TypeScript, Node.js 20
- 모노레포: **pnpm workspaces** — `packages/core`(공유), `packages/functions`, `packages/dashboard`
- 공유 패키지 `@adref/core`: **tsup** 빌드(esm+cjs+dts). 어댑터·DB·도메인·설정 단일 정의
- 데이터 레이어: **Drizzle ORM + drizzle-kit** — 스키마 1회 정의 → 순수 `.sql` 마이그레이션(로컬·Azure 공용). `pgcrypto` 확장 필요
- 수집기: **Azure Functions v4** (Timer/Queue Trigger) — 로컬은 Functions Core Tools. 배포는 **esbuild 단일 번들**(pnpm 심링크 회피)
- 큐/스토리지: Azure Storage Queue + Blob — 로컬은 **Azurite**(`--skipApiVersionCheck` 필요)
- DB: PostgreSQL (로컬 Docker → Azure PostgreSQL Flexible Server)
- 대시보드: Next.js 14 App Router — **DB 직접 조회**(수집기=쓰기, 대시보드=읽기). 로컬 `next dev` → App Service
- 외부 소스: SerpApi (Ads Transparency API), YouTube Data API v3
- 테스트: **Vitest** (단위=core, 핸들러=functions). HTTP 목킹은 fetch 주입/undici

## 아키텍처 규칙

- 클라우드에 닿는 것(SerpApi/YouTube/큐/Blob/DB)은 `@adref/core` 어댑터 인터페이스 + `factory(env)` 뒤에 둔다.
- 실제 로직은 어댑터를 인자로 받는 **순수 DI 핸들러**(`packages/functions/src/handlers/*`)에 두고, 트리거(`functions/*`)는 얇게 배선만 한다.

## Git 병합 규칙

- PR 병합은 **merge commit** 으로 한다: `gh pr merge <n> --merge --delete-branch`. **squash 병합 금지** — 브랜치의 개별 커밋이 하나로 합쳐져(사실상 삭제) 히스토리가 선형이 되기 때문.
- 목적: main 히스토리에 브랜치가 갈라졌다 병합되는 **그래프**(두 부모 merge commit)가 남아, `git log --graph`·GitHub network graph 에서 병합 이력이 보이도록 한다.
- 브랜치 ref 는 병합 후 삭제해도 무방하다 — 커밋은 merge commit 을 통해 main 에 보존된다.
- 작업은 `feature/*`·`fix/*`·`chore/*` 브랜치에서 하고 main 직접 push 는 금지 (전역 브랜치 정책).

## 수집 스코프 (중요)

- **수집·표시 스코프는 `COLLECT_FORMATS` env 로 제어한다** — `video`(기본, 비디오만) / `all`(텍스트·이미지 포함). 되돌리려면 이 값만 `video` 로 바꾸면 됨(수집기·대시보드 공통, 코드 변경 없음). `isFormatAllowed(format, scope)` 헬퍼가 목록 수집 단계에서 신규 감지·저장을 필터한다.
- **조회수·좋아요·클릭수는 텍스트/이미지 광고에 없다.** 투명성 센터(크롤·SerpApi)는 상업 광고의 조회/클릭/노출/비용을 공개하지 않는다(정치·선거 광고만 노출·비용 range 제공). 비디오 조회수·좋아요는 YouTube 영상 ID 로 YouTube API 를 교차조회해 얻는 것이라 텍스트/이미지엔 해당 없음. 텍스트/이미지에서 확보 가능한 추가 메타데이터는 `image_url`(이미지 크리에이티브 URL)·`headline`(문구)·랜딩 URL·게재기간뿐.
- **광고 구성요소 저장·재현:** 투명성 센터의 완성 광고는 `배너 이미지(또는 영상) + 브랜드 로고 + headline + description + CTA` 조합이다. 이 요소를 `ads.image_url·logo_url·headline·description·cta_text` 에 저장(마이그레이션 0003·0004)하고 **대시보드 상세에서 흰 배경 광고 카드로 조합 렌더링**한다(실제 광고 단위는 흰 바탕 — 다크 테마를 물려받으면 안 됨). content.js 의 `headline`/`longHeadline`·`description`/`body_text`·`callToActionText`·`logo` 에서 추출. **로고는 base64 데이터 URI(~10KB)일 수 있어** 목록 쿼리(AdCard)에는 싣지 않고 상세에서만 조회한다.
- **대안(variation) 전량 수집:** 상세 페이지의 "대안" 카드 = `GetCreativeById` variation 배열. **대안마다 사이즈·headline·description·CTA 가 다르다** → `ad_variations` 테이블(마이그레이션 0005, `(ad_id, idx)` 멱등 upsert)에 대안별 `width/height`(content.js `previewMetadata` 실측)·문구·로고·랜딩을 전부 보존한다. 이미지·텍스트는 대안 전부(≤6) 미리보기 fetch, **비디오는 문구 확보 시 조기 중단**(동일 영상 사이즈 변형이라 가치 낮고 1,300+건 요청 폭증 방지). `ads` 의 구성요소 컬럼은 "첫 확보값"(목록 카드·검색용).
- **스크린샷 캡처는 시도 후 취소됨(2026-07-30):** 확장 `captureVisibleTab` 방식(대안 iframe 별 캡처·크롭)을 구현했으나 지연 렌더로 빈 캡처가 잦고 캡처 중 창 점유 제약이 커서 **사용자 결정으로 원복**했다(마이그레이션 0006 에서 `ad_variations.screenshot` 컬럼 제거). 광고 재현은 조합 렌더링(구성요소+대안)으로 한다. 재도입하려면 지연 렌더(뷰포트 진입 후 ~6초) 프리워밍과 단색(빈 캡처) 감지·재시도가 필요하다는 실측 교훈 참조.
- **상세 미리보기 크기:** 배너/영상은 패널 폭 그대로 크게 표시한다(축소 카드 금지 — 사용자가 두 차례 원복 요청). 문구·CTA·로고는 배너 아래에 렌더. 대안별 축소 카드는 "대안" 섹션에만 사용.
- 대시보드: 비디오는 **YouTube 임베드**(비-YouTube 영상은 만료되므로 투명성 센터 링크), 이미지는 `image_url` 표시, 텍스트는 `headline` 표시. 목록의 "조회수 없는 항목 숨김"은 스코프 `all`일 때 **비디오에만** 적용(텍스트/이미지는 원래 조회수가 없으므로 항상 표시).
- 영상 원본 파일은 저장하지 않는다 (URL 만 확보).

## 회원/즐겨찾기 (대시보드)

- 회원가입은 **`nizcorp.com`·`shaperon.com` 도메인 이메일만** 허용 — 화이트리스트는 `packages/dashboard/lib/accounts.ts` 의 `ALLOWED_SIGNUP_DOMAINS`(서버 측 검증).
- 인증은 외부 의존성 없이 구현: 비밀번호 scrypt(`salt:hash`, Node 내장 crypto) + DB 세션(`user_sessions`) + httpOnly 쿠키(`adref_session`, 30일). Azure 배포 시 Easy Auth(Entra)로 대체 가능하나 현재는 자체 세션이 기준.
- 즐겨찾기는 `ad_favorites (user_id, ad_id)` — 광고/사용자 삭제 시 cascade. UI: 카드·상세 ♥ 토글(비로그인 클릭 → /login), 목록 "♥ 즐겨찾기만" 필터(`?fav=1`).

## 규칙

- 시크릿(SerpApi·YouTube 키)은 코드/문서에 하드코딩 금지. 로컬은 `.env`/`local.settings.json`, Azure는 Key Vault.
- DB 스키마 변경은 로컬·Azure 공용 마이그레이션 스크립트로만 반영한다 (`schema.ts` 수정 → `db:generate` → `migrate`).
- 수집기는 멱등 설계(`creative_id` upsert, `ad_metrics` 스냅샷 이력 보존), raw jsonb 보존, 쿼터 가드를 유지한다.
- 조회수·좋아요는 두 경로로 채운다: (1) 상세 수집(`collectAdDetail`) 시 해당 영상 통계를 즉시 스냅샷(신규 광고 즉시 표시), (2) 일별 Timer(`collectViewCounts`)로 전체 갱신(성장 추세). `videos.list?part=snippet,statistics` 한 번에 viewCount·likeCount·publishedAt(게시일)을 함께 받아 `ad_metrics`(yt_view_count·yt_like_count)와 `ads.published_at` 에 적재(둘 다 1유닛·무료). YouTube Data API 는 무료라 SerpApi/크롤 쿼터와 무관. 비공개·삭제 영상은 통계 미제공(값 없음, 정상). 좋아요 비공개 영상은 likeCount 만 없을 수 있음.
- **최신순 정렬**은 영상 게시일(`ads.published_at`, YouTube `snippet.publishedAt`) 기준이다(수집 시각 아님). 게시일이 없으면 `coalesce(published_at, first_shown, collected_at)` 로 폴백. 게시일은 불변이라 1회만 저장(upsert 는 새 값 있을 때만 갱신, 일별 Timer 가 기존 광고 백필). **대시보드는 조회수 미확인 영상(비-YouTube·비공개·삭제)을 목록에서 숨긴다**(`latestViews IS NOT NULL`, 비파괴).
- **일별 조회수/좋아요 원리:** YouTube Data API v3 전체 20개 리소스 중 조회수·좋아요는 `Videos` 만 제공하고 **현재 누적값만** 준다(`videos.list`·`batchGetStats` 모두 일별 이력 없음). Analytics API 의 `dimensions=day` 시계열은 소유자 OAuth 전용이라 경쟁사 영상 불가. 따라서 경쟁사 영상의 "일별 조회수/좋아요"는 **매일 누적을 스냅샷해 전일 대비 delta 로 자체 시계열을 구축**하는 방식뿐이며, 수집 시작 이후만 가능(과거 백필 불가). 첫 스냅샷은 그 시점 누적 총량.
- `@adref/core` barrel(`index.ts`)에는 `import.meta` 의존 모듈(`migrate.ts`)을 export 하지 않는다 (CJS 소비 시 깨짐).

## SerpApi 실측 메모 (2026-07)

- **필드 매핑:** 목록은 `ad_creative_id`·`total_days_shown`·Unix 정수 게재일, 상세는 `ad_creatives[]` 변형 배열의 `video_link`·`visible_link`. format·게재일은 **목록에만** 있어 큐 메시지로 상세 수집기에 전달한다.
- **광고주 탐색:** SerpApi 는 회사명 검색을 지원하지 않는다. `text=<도메인>`(예: `text=coupang.com`) **도메인 검색**으로만 advertiser_id 를 얻으며, 응답 `ad_creatives[].advertiser_id`·`advertiser` 에서 추출한다. 한 도메인에 **여러 광고주**(본사·해외지사·대행사)가 나오므로 자동 확정 금지 — 대시보드에서 후보를 사용자가 선택한다(PROJECT.md §4.5).
- **region:** SerpApi 는 ISO 코드("KR")를 거부하고 **숫자 geo target 코드**를 요구한다(KR=2410, US=2840). `serpapi.ts` 의 `toSerpApiRegion` 이 매핑하며, DB `competitors.region` 은 ISO 코드로 유지한다.
- **DB 배열 컬럼:** `text[]`(예: `platforms`) 필터는 raw `ANY(${array})` 대신 Drizzle `inArray()` 를 쓴다 (배열 리터럴 직렬화 오류 방지).
- **상세 "결과 없음":** 일부 크리에이티브는 상세 API 가 "hasn't returned any results" 를 반환한다(영구 조건). `getAdDetail` 은 이 경우 예외 대신 빈 상세(`raw.detailUnavailable`)를 반환해 목록 데이터만으로 저장 — 재시도·포이즌·쿼터 낭비를 막는다.
- **쿼터 주의:** 광고 N건 수집 = 목록 1 + 상세 N SerpApi 호출. "지금 수집"으로 대형 광고주(40건)를 수집하면 ~41회 소모. Free 250/월 에선 몇 번이면 소진 — 운영은 Developer 5000/월. 대형 광고주 폭주 방지로 `collectForCompetitor` 에 `maxTotal` 상한 지원.

## 브라우저 확장 수집 (Chrome extension → /api/ingest)

- **동기:** 서버(로컬·DGX 등 데이터센터 IP)로 직접 크롤하면 Google `/sorry`(비정상 트래픽 차단)에 막힌다. **실제 사용자 브라우저의 first-party 요청은 차단을 회피**하므로, Chrome 확장이 투명성 센터에서 수집해 백엔드로 전송한다. (Playwright 헤드리스는 탐지되므로 사용 안 함)
- 확장(`tools/chrome-extension/`): content script 가 adstransparency.google.com 페이지 컨텍스트에서 `SearchCreatives`·`GetCreativeById` 를 **same-origin** 호출(파싱은 `transparencyCrawl.ts` 와 동일), 미리보기 content.js·백엔드 POST 는 background 서비스워커가 대행(CORS 회피). 이미 저장된 것은 `/api/known` 으로 걸러 **신규만 상세 요청**.
- **⚠️ 쿠키를 보내면 XSRF 토큰이 필요하다(실측):** `credentials:'include'` 로 쿠키를 실으면 anji 가 CSRF 방어를 발동해 `400 XsrfException: XSRF token is MISSING` 을 반환한다(로그인 여부 무관 — NID 같은 쿠키만 있어도 발동). 확장은 페이지 HTML 에서 XSRF 토큰을 찾아 `x-framework-xsrf-token` 헤더로 보내고, 없거나 거부되면 **XSRF 검사가 없는 익명 호출(`credentials:'omit'`)로 자동 폴백**한다. 쿠키를 보내는 목적은 CAPTCHA 면제 쿠키로 `/sorry` 를 우회하는 것.
- 확장은 `GetCreativeById` 응답을 `raw` 로 함께 전송해 DB `ads.raw` 에 보존한다 — 추출이 실패했을 때 재수집·라이브 요청 없이 raw 로 구조를 진단할 수 있다(로컬 IP 가 차단된 상태에서도 원인 파악 가능).
- 백엔드 엔드포인트(`packages/functions/src/functions/ingestHttp.ts`, CORS 허용): `POST /api/ingest`(저장), `POST /api/known`(기존 creative_id), `GET /api/advertisers`(경쟁사 목록). 저장 핸들러 `ingestCreatives` 는 collectAdDetail 의 저장 계층 재사용 — creative_id 멱등 upsert + (비디오면)YouTube 조회수/좋아요/게시일 스냅샷(서버 측, 무료). 저장 스코프는 `COLLECT_FORMATS` 따름(확장은 전체 전송, 백엔드가 필터).
- 사용법·설치는 `tools/chrome-extension/README.md`. 요청 간격(delay)·차단 감지 자동 중단 내장.
- **연속 수집 한도(2026-07-31 실측):** 확장으로 한 번에 502건 연속 상세 수집 시 봇 차단됨 → 한 실행의 상세 수집을 `maxPerRun`(팝업 "연속 한도", 기본 500)으로 제한. `/known` 이 수집분을 걸러 다음 실행에서 이어서 수집(중단 지점 저장 불필요).
- **예약 자동 수집(chrome.alarms)은 구현 후 원복됨(2026-07-31):** 로컬 Chrome 프로필에 의존하는 스케줄러라 운영이 Azure 로 이전하면 무용하다는 판단. 자동화가 다시 필요하면 Azure 측(서버 크롤 Timer 또는 별도 브라우저 워커)에서 설계할 것 — 당시 구현은 PR #70/#71 참조.

## 데이터 소스 스위칭 (SerpApi ↔ 크롤)

- `ADS_SOURCE` 환경변수로 **서버 측** 광고 데이터 소스를 고른다(브라우저 확장 경로와 별개). **롤백은 이 값만 변경**(코드 변경 없음):
  - `serpapi` (기본·안정·유료): `SerpApiAdsSource`. SerpApi 코드는 크롤 도입과 무관하게 유지 → 롤백 경로 안전.
  - `crawl` (무료·비공식·실험적): `TransparencyCrawlAdsSource`. 투명성 센터 내부 RPC 직접 호출(curl).
    - 목록: `SearchService/SearchCreatives`, req `{"2":n,"3":{"12":{"1":"","2":true},"13":{"1":[advertiserId]}},"7":{"1":1,"2":0,"3":region}}`, 페이지네이션=req field `4`(=응답 field `2` 토큰). 응답 item: `2`=creativeId, `4`=format(1/2/3), `6`/`7`=Unix 게재일.
    - 상세: `LookupService/GetCreativeById` → 응답 `['1']['5']`=variation 배열. **비디오·텍스트**는 `variation['1']['4']`=미리보기 `content.js` URL → fetch → YouTube ID 추출(`ytimg.com/vi/<id>` + `video_id` 필드). **이미지**는 `variation['3']['2']` 에 `<img src="…/archive/simgad/…">` HTML 이 **응답에 직접** 포함(미리보기 fetch 불필요) → src 추출. **실제 광고 크리에이티브는 `/archive/simgad/` 경로**이고, archive 없는 `/simgad/` 는 광고주 **로고**(크기 무관 — 2084² 대형 로고도 존재하므로 크기로 못 거름), `/pagead/` 는 HTML 자산 → `isRealCreativeUrl` 이 셋을 구분해 로고·자산을 제외한다. format=image 라도 discover/HTML 광고는 정적 이미지가 없어 image_url 없음(정상).
    - **⚠️ 미리보기 URL 은 variation[0] 에만 있는 게 아니다(실측):** 이미지 광고는 variation[0] 이 정적 `<img>` HTML(`['3']['2']`)이라 `['1']['4']`(content.js)가 없고 미리보기는 **뒤쪽 variation** 에만 있다. variation[0] 만 보면 이미지 광고의 문구·CTA·랜딩 URL 이 통째로 누락된다. → 모든 variation 에서 미리보기 URL 을 모아 순서대로 시도하고 문구를 확보하면 중단한다(대부분 1요청, variation 별로 레이아웃/문구가 다르므로 최대 3개).
    - 랜딩·문구: content.js 의 `destination_url`(전체 URL) 우선, 없으면 `visible_url`(도메인은 https 보정). 문구는 `headline`→`longHeadline`→`description` 폴백. `GetCreativeById` 응답엔 랜딩 필드 없음.
    - **⚠️ content.js 템플릿은 세 종류다(실측):** (1) `adData` JSON 템플릿(discover 등) — `\x27headline\x27: \x27…\x27` 형태 → `fieldValue` 로 추출. (2) **HTML 마크업 템플릿**(creativeType 46 이미지 레이아웃) — adData 없이 완성 HTML 이 직접 들어있다 → `componentsFromHtmlTemplate` 이 폴백: 문구=`title`/`body` 클래스 div 안의 `<a>` 텍스트(`<br>`→공백), CTA=`data-asoch-targets="…btnClk…"` 앵커, 랜딩=클릭 URL 의 `adurl=` 파라미터(percent-decode), 로고=정사각 소형(w=h≤200) `background-image` simgad, 배너=그 외 bg 이미지 중 최대 면적(쿼리 제거=원본 해상도). 이미지 광고 상당수가 이 템플릿이라 fieldValue 만으론 문구가 통째로 빈다. (3) **검색형 텍스트 광고("Single Ad Rendering Service")** — `AF_dataServiceRequests` 의 `"361903925"` 배열 `[ …null×7, headline, visibleUrl, description, … ]` → `componentsFromSearchAdTemplate`. **크리에이티브 이미지가 원래 없는 유형**(내장 data:image 는 별점 등 UI 아이콘 조각 — 이미지 미수집이 정상).
    - **raw 백필:** 추출기가 개선되면 재수집 없이 `scripts/backfill-from-raw.mts` 로 기존 광고를 보강한다 — 저장된 raw 의 미리보기 URL(googleusercontent CDN, 봇 차단 대상 아님)만 다시 받아 재추출하므로 RPC(/sorry 차단)와 무관.
    - **⚠️ content.js 필드명 따옴표 유무가 섞여 있다**(실측): adData 최상위는 `destination_url: \x27값\x27`(**무따옴표**), `google_template_data` 내부는 `\x27headline\x27: \x27값\x27`(따옴표). `fieldValue` 정규식이 **양쪽을 모두** 잡아야 한다 — 예전엔 무따옴표를 놓쳐 랜딩 URL 확보율이 낮았다("best-effort"의 원인).
    - **content.js 는 정적 텍스트다** — fetch 응답이 즉시 완전하므로 "렌더링 대기"는 기술적으로 불필요(브라우저의 시각적 iframe 렌더 완료와 무관). 필요한 값(YouTube ID·이미지·랜딩·문구)은 모두 텍스트에서 정규식으로 추출된다. discover 레이아웃 비디오 광고는 `thumbnail`/`video_videoId` 에 YouTube ID 가 들어있다.
    - **"상세 대기" 기능은 도입 후 제거됨(2026-07-31):** 이미지·텍스트 상세의 6000ms 대기를 실측 검증한 결과 수집 품질과 무관했다(content.js 는 정적 — 백필 0ms = 6000ms 결과 동일, 모든 미수집 사례의 원인은 템플릿 파서 커버리지). 옵션·입력란까지 전부 제거 — 재도입 논의 시 이 실측을 참조.
    - 조회수: 크롤과 무관 — YouTube Data API(무료)로 수집(youtube_video_id 있으면). 투명성 센터는 상업광고 조회수 미제공.
    - **제한**: 랜딩 URL 불안정(best-effort), 도메인 검색 미지원(회사명 검색 사용). `apiCalls=0`(쿼터 미소모).
    - **리스크**: 비공식·형식 변동 시 조용히 빈 결과, 대량 시 봇 차단 가능, ToS. 깨지면 `ADS_SOURCE=serpapi` 로 롤백.
- 전체 수집: `collectForCompetitor` 가 `nextPageToken` 으로 페이지네이션(최대 300페이지). "지금 수집" 기본 상한은 크롤=무제한(스크롤 끝까지)·serpapi=100. (투명성 센터는 스크롤 시 추가 로딩 방식 → nextPageToken 으로 끝까지 순회)
- **대량 크롤 차단 주의:** 광고 수백~수천 건을 크롤하면 상세 요청 폭주로 Google 봇 차단(HTML 응답 또는 `/sorry` 302) 발생. 완화책: **큐 동시성 1**(`batchSize=1`·`newBatchThreshold=0` — batchSize+threshold 가 동시 실행 수라 2/1 설정은 최대 3병렬 = 실효 간격이 1/3 로 줄어 차단됐음, 실측) + 크롤 전송 계층의 **프로세스 전역 직렬화 게이트**(모든 요청이 한 줄로 서서 `CRAWL_THROTTLE_MS` 지연 보장, 지터로 값~2배 — 확장의 순차 수집과 동일한 프로파일). 직렬화 후 `CRAWL_THROTTLE_MS=1500` 으로 운용(확장 1200ms 순차 전량 수집 통과 실측 근거). 차단은 **IP 레이트리밋**이 주원인이라 헤더 위조로는 못 피한다(TLS/HTTP2 지문은 curl 로 흉내 불가, 탐지 회피 도구는 도입 안 함). 차단 시 수십 분~수 시간 후 자동 해제 — 그 사이 재시도 금지(연장됨).
- **실측 총량 (2026-07-30, 목록 페이지네이션 전량 순회):** 페이지네이션은 **중복 0·상한 미도달로 전량을 정확히 가져온다**(투명성 센터 UI 의 광고 수 표시는 실제 크리에이티브 수와 다름). 광고주별 실제: 드래프터 429/521, 더스크랙 446, **아이리스브라이트 6,860**(172페이지, 872초, throttle 3~6초에서 차단 없음).
- **병목은 목록이 아니라 상세다.** 목록은 광고주당 11~172요청(수분)이지만 상세는 **광고 1건당 1요청** → 미수집 수천 건이면 8~11시간. 하루에 몰면 차단되므로 **일별 분산 누적**(일별 Timer) 또는 **최신 우선 부분 수집**으로 나눈다. `scripts/test-pagination.mts` 로 광고주별 실제 총량을 재측정할 수 있다(목록만 호출, 상세 미사용).

## 광고주 이름 검색 (Google 투명성 자동완성)

- 회사명 → 광고주 후보는 **Google 투명성 센터 내부 RPC** `SearchService/SearchSuggestions` 로 얻는다(`GoogleTransparencyAdvertiserSearch`). SerpApi 는 회사명 검색 미지원.
- 요청: `f.req={"1":<회사명>,"2":<limit>}`. 응답 필드번호 매핑: `1[].1.1`=이름, `.2`=advertiser_id, `.3`=지역, `.4.2`={low,high}=광고 수.
- **전송은 curl 서브프로세스**: Google 은 Node(undici·https)의 TLS 시그니처를 봇으로 탐지·차단하므로, `execFile('curl', [...])`(셸 미경유·인젝션 안전)로 호출한다. curl 은 dev(macOS)·Azure App Service(Linux)에 기본 포함. 테스트는 `transport` 주입으로 파서만 검증.
- **비공식:** 브라우저 헤더(user-agent·origin·referer) 필요. 여전히 best-effort — 확정 경로는 도메인 검색(SerpApi).
- **Azurite:** Azure SDK 최신 API 버전 미지원 시 `--skipApiVersionCheck` 필요 (docker-compose 반영됨).

## Azure 운영 (Phase 4 프로비저닝 완료, 2026-07-31)

- **배포 파이프라인:** main 병합 시 GitHub Actions `deploy.yml` 이 테스트 → Functions(esbuild 번들: host.json+package.json+dist, node_modules 불필요) → 대시보드(Next standalone: 모노레포 경로 `packages/dashboard/server.js`, 빌드 시 더미 DATABASE_URL) 순서로 자동 배포. 인증은 publish profile 시크릿(`AZURE_FUNCTIONAPP_PUBLISH_PROFILE`·`AZURE_WEBAPP_PUBLISH_PROFILE`).

- 리소스: `rg-adref-prod`(Korea Central) — PG `adref-pg-hdhtrcfw3gtpg`(B1ms·v16), KV `adref-kv-hdhtrcfw3gtpg`(시크릿: serpapi-key·youtube-api-key·pg-admin-password), Functions `adref-func-hdhtrcfw3gtpg`, Web `adref-web-hdhtrcfw3gtpg`, Storage `adrefsthdhtrcfw3gtpg`. IaC 는 `infra/bicep/main.bicep`.
- **Azure PG 는 `azure.extensions=PGCRYPTO` 서버 파라미터를 켜야 pgcrypto 확장 생성 가능**(실측 — 없으면 마이그레이션 0000 실패).
- Azure Functions 의 `ADS_SOURCE` 기본은 `serpapi` — 데이터센터 IP 는 투명성 센터 크롤이 차단되기 쉬움. 확장 수집은 팝업 백엔드 주소를 Functions URL 로 바꿔 병행.
