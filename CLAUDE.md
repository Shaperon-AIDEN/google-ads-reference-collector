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

- **비디오 광고만 수집한다.** 이미지·텍스트 광고는 대상이 아니다 — 목록 수집 단계에서 `format === 'video'` 만 신규 감지·큐 적재·저장한다.
- 대시보드 영상 재생은 **YouTube 영상만** 지원(임베드). 비-YouTube 영상(googlevideo 스트림 URL)은 만료되므로 재생 대신 원본 링크(투명성 센터)만 제공한다.
- 영상 원본 파일은 저장하지 않는다 (URL 만 확보).

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
- 백엔드 엔드포인트(`packages/functions/src/functions/ingestHttp.ts`, CORS 허용): `POST /api/ingest`(저장), `POST /api/known`(기존 creative_id), `GET /api/advertisers`(경쟁사 목록). 저장 핸들러 `ingestCreatives` 는 collectAdDetail 의 저장 계층 재사용 — creative_id 멱등 upsert + YouTube 조회수/좋아요/게시일 스냅샷(서버 측, 무료). **비디오만** 저장.
- 사용법·설치는 `tools/chrome-extension/README.md`. 요청 간격(delay)·차단 감지 자동 중단 내장.

## 데이터 소스 스위칭 (SerpApi ↔ 크롤)

- `ADS_SOURCE` 환경변수로 **서버 측** 광고 데이터 소스를 고른다(브라우저 확장 경로와 별개). **롤백은 이 값만 변경**(코드 변경 없음):
  - `serpapi` (기본·안정·유료): `SerpApiAdsSource`. SerpApi 코드는 크롤 도입과 무관하게 유지 → 롤백 경로 안전.
  - `crawl` (무료·비공식·실험적): `TransparencyCrawlAdsSource`. 투명성 센터 내부 RPC 직접 호출(curl).
    - 목록: `SearchService/SearchCreatives`, req `{"2":n,"3":{"12":{"1":"","2":true},"13":{"1":[advertiserId]}},"7":{"1":1,"2":0,"3":region}}`, 페이지네이션=req field `4`(=응답 field `2` 토큰). 응답 item: `2`=creativeId, `4`=format(1/2/3), `6`/`7`=Unix 게재일.
    - 상세: `LookupService/GetCreativeById` → 미리보기 `content.js` fetch → YouTube ID 추출(`ytimg.com/vi/<id>` URL 형식 + `video_id` 필드 형식 둘 다).
    - 랜딩: content.js 의 `destination_url`(전체 URL) 우선, 없으면 `visible_url`(도메인은 https 보정). **단 content.js 렌더가 비결정적이라 랜딩은 best-effort(일부만 확보)**. `GetCreativeById` 응답엔 랜딩 필드 없음.
    - 조회수: 크롤과 무관 — YouTube Data API(무료)로 수집(youtube_video_id 있으면). 투명성 센터는 상업광고 조회수 미제공.
    - **제한**: 랜딩 URL 불안정(best-effort), 도메인 검색 미지원(회사명 검색 사용). `apiCalls=0`(쿼터 미소모).
    - **리스크**: 비공식·형식 변동 시 조용히 빈 결과, 대량 시 봇 차단 가능, ToS. 깨지면 `ADS_SOURCE=serpapi` 로 롤백.
- 전체 수집: `collectForCompetitor` 가 `nextPageToken` 으로 페이지네이션(최대 300페이지). "지금 수집" 기본 상한은 크롤=무제한(스크롤 끝까지)·serpapi=100. (투명성 센터는 스크롤 시 추가 로딩 방식 → nextPageToken 으로 끝까지 순회)
- **대량 크롤 차단 주의:** 광고 수백~수천 건을 크롤하면 상세 요청 폭주로 Google 봇 차단(HTML 응답, "파싱 실패") 발생. 완화책: 큐 `batchSize=4`, 크롤 전송 `CRAWL_THROTTLE_MS`(기본 500ms) 지연. 그래도 단일 IP 로 대형 광고주(수천 건) 전체 크롤은 한계 — 시간 분산(일별 Timer 누적) 또는 SerpApi(유료·안정) 권장. 차단 시 잠시 대기 후 재개.

## 광고주 이름 검색 (Google 투명성 자동완성)

- 회사명 → 광고주 후보는 **Google 투명성 센터 내부 RPC** `SearchService/SearchSuggestions` 로 얻는다(`GoogleTransparencyAdvertiserSearch`). SerpApi 는 회사명 검색 미지원.
- 요청: `f.req={"1":<회사명>,"2":<limit>}`. 응답 필드번호 매핑: `1[].1.1`=이름, `.2`=advertiser_id, `.3`=지역, `.4.2`={low,high}=광고 수.
- **전송은 curl 서브프로세스**: Google 은 Node(undici·https)의 TLS 시그니처를 봇으로 탐지·차단하므로, `execFile('curl', [...])`(셸 미경유·인젝션 안전)로 호출한다. curl 은 dev(macOS)·Azure App Service(Linux)에 기본 포함. 테스트는 `transport` 주입으로 파서만 검증.
- **비공식:** 브라우저 헤더(user-agent·origin·referer) 필요. 여전히 best-effort — 확정 경로는 도메인 검색(SerpApi).
- **Azurite:** Azure SDK 최신 API 버전 미지원 시 `--skipApiVersionCheck` 필요 (docker-compose 반영됨).
