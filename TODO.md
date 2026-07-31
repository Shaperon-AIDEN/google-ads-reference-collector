# TODO — 구글 광고 레퍼런스 수집 시스템

진행 방식: **로컬 우선 구현 → 전체 기능 테스트 완료 → Azure 배포**
상세 설계는 [PROJECT.md](./PROJECT.md) 참조.

범례: `[ ]` 미착수 · `[~]` 진행 중 · `[x]` 완료 · 🚧 게이트

---

## 스코프 조정 — 비디오 광고 전용 (2026-07-24 확정)

- [x] **수집 대상을 비디오 광고로 한정** — `collectAdList`·`collectForCompetitor` 가 `format === 'video'` 만 감지·수집 (이미지·텍스트 제외). 단위테스트 추가
- [x] **영상 재생 정책**: 대시보드는 YouTube 영상만 임베드 재생. 비-YouTube 영상(googlevideo 만료 URL)은 상세에서 **투명성 센터 원본 링크** 제공
- [x] **기존 비-비디오 데이터 삭제** — 로컬 DB 의 이미지 22·텍스트 14건 제거(비디오만 잔존). (Azure 배포 시 동일 1회 정리 필요)
- [x] 검증 — 레퍼런스 리스트 비디오만 표시, 비-YT 상세 투명성 센터 링크 렌더, 테스트 40건 통과

---

## Phase 0 — 기술 검증 (로컬)

- [x] SerpApi (Ads Transparency API) 계정·키 발급, 응답 스키마 **실측** — Free Plan(250회/월). 실제 응답으로 어댑터 필드 매핑 확정, 픽스처 저장(`packages/core/test/fixtures/serpapi-{list,detail}.json`)
- [x] 실측으로 발견·수정한 스키마 차이 (가정 → 실제): `creative_id`→**`ad_creative_id`**, 게재일 ISO→**Unix 정수**, 게재일수 계산→**`total_days_shown` 제공**, 상세 `ad_details` 객체→**`ad_creatives` 변형 배열**, 랜딩 `target_url`→**`visible_link`**, 영상=**`video_link`**(youtube embed). format·게재일은 목록에만 존재 → 큐 메시지로 상세 수집기에 전달
- [x] 실 API E2E 경로 검증 (어댑터 목록→상세→`parseYouTubeId`→`landingDomain`): Tesla 광고 실데이터로 `TOnJMLfOZCs` / `tesla.com` 도출 확인
- [x] YouTube Data API v3 키 발급, 실키 검증 (`.env` 저장, videos.list statistics 실측 — Tesla 광고 영상 조회수 확보)
- [x] **광고주 ID 탐색 방식 실측** — SerpApi 는 회사명 검색 미지원, `text=<도메인>` 도메인 검색만 가능. 한 도메인에 다광고주 후보 확인(tesla.com→Tesla Inc.+대만법인, coupang.com→쿠팡 주식회사 등) → 대시보드 온보딩에서 후보 선택 방식으로 설계(PROJECT.md §4.5, Phase 2)
- [ ] 수집 대상 경쟁사 **도메인 목록** 정의 (발주처 입력) — advertiser_id 는 대시보드 온보딩이 자동 탐색하므로, 필요한 건 경쟁사 도메인 목록뿐
- [ ] 조회수 대체 지표 등 v1.0 공통 리스크 항목 실측 확인 (선정된 경쟁사 대상 YouTube 영상 확보율 측정 → 발주처 기대치 합의)
- [x] 데이터 모델(경쟁사·광고·지표·이력) 확정 — `packages/core/src/db/schema.ts` (4 테이블, v1.0 5장 반영)

## Phase 1 — 수집 파이프라인 (로컬)

### 모노레포·환경 기반

- [x] pnpm 워크스페이스 스캐폴딩 (`pnpm-workspace.yaml`, 루트 `package.json`, `tsconfig.base.json`)
- [x] `@adref/core` 패키지 구성 (tsup 빌드, typecheck·build 통과)
- [x] `docker-compose.yml` — 로컬 PostgreSQL 16 + Azurite(Blob/Queue/Table) 정의
- [x] `local.settings.json` / `.env` 로 시크릿·엔드포인트 주입 구조 마련 (`.env.example`, zod 검증 `config/env.ts`)
- [x] DB 마이그레이션 스크립트 작성 (로컬·Azure 공용) — `drizzle/0000_*.sql` 생성, `pgcrypto` 확장 포함, `applyMigrations()` 러너

### 어댑터·도메인 (core)

- [x] 광고 소스 어댑터 인터페이스 + SerpApi 구현 + factory (`adapters/ads-source/*`)
- [x] 큐 어댑터 (Azure Storage Queue / Azurite 공용) + factory (`adapters/queue/*`)
- [x] Blob 어댑터 (Azure Blob / Azurite 공용) + factory (`adapters/blob/*`)
- [x] YouTube Data API 어댑터 (50건 배치) + factory (`adapters/youtube/*`)
- [x] 멱등 upsert 리포지토리 (`ads.upsertByCreativeId`, `adMetrics.insertSnapshot` = 이력 보존)
- [x] 도메인 유틸: `parseYouTubeId`, `landingDomain`, `QuotaGuard`(80% 스로틀)
- [x] core 테스트 통과 (parseYouTubeId·landingDomain·quotaGuard·serpapi 매핑/raw 보존 + **실측 픽스처 계약 테스트**)

### 수집기 구현 (functions, Azure Functions v4)

- [x] `@adref/functions` 패키지 구성 (host.json maxDequeueCount=5, esbuild 번들, typecheck·build 통과)
- [x] 순수 DI 핸들러 + 얇은 트리거 분리 (`handlers/*` ↔ `functions/*`), `buildDeps` 컨텍스트 배선
- [x] 광고 목록 수집기 (Timer Trigger) — 신규 광고 감지 → Storage Queue 적재
- [x] 상세 수집기 (Queue Trigger) — SerpApi 상세 조회, DB upsert(`creative_id`), 썸네일 Blob 저장, 재시도→포이즌 큐
- [x] 조회수 수집기 (Timer Trigger, 일별) — YouTube API 조회수 → `ad_metrics` 일별 스냅샷
- [x] 목록 수집기 핸들러 테스트 (신규감지·쿼터 스로틀 partial) 통과

### 로컬 스택 실측 검증

- [x] Docker 스택 기동 (PostgreSQL 16 + Azurite) 및 마이그레이션 실제 적용 — 4 테이블·UNIQUE·FK·pgcrypto 확인
- [x] seed 스크립트 2회 실행 → advertiser_id 멱등 upsert (3행 유지) 실측
- [x] Azurite 큐 왕복(enqueue→receive→delete, base64 JSON) 스모크 통과
- [x] 헬퍼 스크립트: `seed.ts`, `trigger.ts`(수동 발화/enqueue), `record-fixtures.ts`(Phase 0 픽스처)
- [x] **YouTube Data API 실키 검증** — 배치 조회(2건→1 호출), bigint viewCount, 없는 ID 제외 확인
- [x] **전체 파이프라인 E2E (실 SerpApi + 실 YouTube + 로컬 PG + Azurite)** — 목록 40건 감지→큐→상세 4건→`ads` 저장→영상 광고(`bkbfSJwdAjQ`) 썸네일 Blob 저장(12.9KB)→조회수 스냅샷(12,634,049 views) 적재. raw jsonb 보존·Unix→date 변환·landing_domain 추출 확인
- [x] 멱등성 실측 — creative_id UNIQUE + upsert 로 재실행 시 ads 중복 0 (at-least-once 큐, 멱등 저장)
- [x] **E2E 로 실제 통합 버그 2건 발견·수정:** (1) SerpApi `region` 은 ISO 코드 거부 → 숫자 geo target 코드 필요(KR→2410 매핑 추가), (2) `existingCreativeIds` 의 `ANY(배열)` 직렬화 오류 → Drizzle `inArray()` 로 교체
- [x] **`func start` 로 3개 트리거 실기동 검증** (Azure Functions Core Tools 4.12.1) — timer 2종·queue 1종 등록, `%AD_QUEUE_NAME%`/`%*_CRON%` 앱설정 주입 확인
- [x] **Queue Trigger 자동 소비** 검증 — 유효 메시지 자동 소비→DB 저장(Succeeded), Timer 트리거 admin 실행→collection_runs 기록
- [x] **포이즌 큐 실측** — 실패 메시지 정확히 5회 재시도 후 `new-ads`→`new-ads-poison` 자동 이동(`MaxDequeueCount of 5`) 확인
- [x] **매일 자동 수집 Timer 로컬 검증** — CRON 을 임시 단축(목록 40s·조회수 50s)해 수동 트리거 없이 자동 발화 확인. adListCollector(신규 23건 감지→큐→상세 23건 처리)·viewCountCollector(105 스냅샷) 정상, collection_runs 기록. 테스트 후 운영 CRON(`0 0 0,12 * * *`·`0 0 3 * * *`)으로 원복
- [x] esbuild 번들 수정 — `pg` external→번들 포함(pnpm 심링크 해석 회피), `pg-native` 만 external

### 미검증 갭 보강 (단위테스트)

- [x] `collectAdDetail` 단위테스트 4건 — youtube 파싱·썸네일 Blob 저장·목록 필드 병합·**썸네일 실패 폴백**·**쿼터 소진 throw**
- [x] `collectViewCounts` 단위테스트 3건 — 스냅샷 적재·대상 없음·**쿼터 소진 partial**
- [x] YouTube 어댑터 단위테스트 5건 — bigint 파싱·**50건 초과 배치 분할**·중복/없는 id 제외·좋아요 숨김·키 누락
- [x] 전체 테스트 **33건** 통과, 타입체크 통과

## Phase 2 — 대시보드 MVP (로컬)

### 경쟁사 온보딩 (도메인 → 광고주 ID 자동 탐색 → 등록 → 수집 연계) — PROJECT.md §4.5

- [x] **core 어댑터**: `AdsSource.searchAdvertisersByDomain(domain, region?)` — SerpApi 도메인 검색에서 `advertiser_id`·`advertiser` 중복 제거해 후보(광고주명·id·광고 수·샘플 썸네일) 반환, 광고 수 내림차순
- [x] **core 어댑터 단위테스트 2건** — 다광고주 중복 제거·정렬·샘플썸네일·id 누락 제외·error 처리 + 실 SerpApi(coupang.com→4후보) 검증
- [x] **대시보드 화면**: 경쟁사 추가(`CompetitorOnboarding`) — 도메인 입력 → 후보 조회 → 후보 선택(복수) → 등록. 도메인마다 반복해 리스트 누적
- [x] **경쟁사 리스트/관리 화면**(`CompetitorList`): 전체 목록 조회·활성/비활성·삭제, 경쟁사별 수집 광고 수
- [x] **route handler**: `POST /search`(도메인→후보), `GET/POST /api/competitors`(리스트/등록), `PATCH/DELETE /api/competitors/[id]`(활성 전환/삭제). SerpApi 키는 서버 측만. **전 API 실동작 검증**(등록 201, 목록·PATCH·DELETE 200)
- [x] **수집 연계 확인**: 온보딩 등록 → `competitors` 활성 행 → 기존 다경쟁사 순회 `collectAdList` 가 자동 포함 (등록 즉시 활성 상태 확인)
- [x] (후속) **즉시 첫 수집**: HTTP 트리거 Function `collectForCompetitor`(단일 경쟁사 목록→앞 8건 인라인 상세+나머지 큐) + 대시보드 "지금 수집" 버튼 + 프록시 route(`/api/competitors/[id]/collect`). **실측 검증** — 쿠팡 40건(즉시 8 + 큐 32)→40/40, 대시보드 프록시 200·멱등(재실행 신규 0)
- [x] (버그수정) 상세 "결과 없음" 그레이스풀 처리 — SerpApi 상세 미제공 크리에이티브를 예외→5회 재시도→포이즌 대신 **목록 데이터만으로 저장**(쿼터 낭비 방지). 포이즌 3건 재구동으로 검증
- [x] (후속) **회사명 광고주 검색** — Google 투명성 자동완성 RPC 어댑터(`GoogleTransparencyAdvertiserSearch`) + 대시보드 온보딩 이름/도메인 모드 토글. 회사명으로 후보(id·지역·광고 수) 검색·등록. ⚠️ 비공식 엔드포인트라 429 차단 가능(브라우저 헤더 필요) → best-effort, 확정 경로는 도메인 검색. 단위테스트 3건
- [x] (후속) **수집 상한** `maxTotal` — 대형 광고주(예: 7000+건) 온디맨드 수집 시 쿼터 폭주 방지
- [x] **실사용 수집 검증** — 드래프터·아이리스브라이트·더스크랙 이름 검색→등록→수집. 30개 영상 광고 전부 YouTube(썸네일·임베드·조회수 28스냅샷, 최대 870만) 대시보드 표시 확인
- [x] (후속) **직접 크롤 데이터 소스** `TransparencyCrawlAdsSource` — 투명성 센터 내부 RPC(SearchCreatives·GetCreativeById) curl 호출로 목록·상세 수집(무료, SerpApi 쿼터 0). 미리보기 content.js 에서 YouTube ID 추출. **`ADS_SOURCE=serpapi↔crawl` 설정만으로 스위칭/롤백** (SerpApi 코드 무변경). 헤드리스 브라우저(Playwright)로 실제 요청 형식 캡처해 확정
- [x] **페이지네이션** — `collectForCompetitor` 가 `nextPageToken` 으로 다중 페이지 수집(전체 수집 지원, maxTotal 상한). 크롤 어댑터 단위테스트 6건
- [x] **크롤 E2E 검증** — 드래프터 12건 수집, **SerpApi 소모 0회** 확인
- [x] **크롤 추출 개선** — YouTube ID **10→12/12**(`ytimg/vi` URL 형식 + `video_id` 필드 형식 모두 지원), 랜딩 URL best-effort(`destination_url`/`visible_url` 도메인 https 보정), 조회수는 YouTube API로 수집(최대 870만 확인)
- [x] **크롤 랜딩 한계 확인** — 랜딩은 content.js 에만 있고 렌더가 비결정적이라 일부만 확보(best-effort). `GetCreativeById` 응답엔 랜딩 필드 없음. 안정적 랜딩 필요 시 SerpApi
- [ ] (후속) **일괄 등록**: 도메인/회사명 여러 개를 한 번에 입력해 순차 탐색·등록
- [x] **전체 수집(스크롤 끝까지)** — `collectForCompetitor` 페이지네이션(nextPageToken, 최대 300p)으로 경쟁사의 모든 광고 순회. "지금 수집" 기본 상한을 크롤=무제한/serpapi=100 으로. 목록 페이지네이션 실증(드래프터 총 527건·비디오 439건, 14페이지 끝까지)
- [x] 대량 크롤 완화책 — 큐 `batchSize` 16→4, 크롤 전송 `CRAWL_THROTTLE_MS`(기본 500ms) 지연
- [ ] **[한계] 대형 광고주 전체 크롤 시 Google 봇 차단** — 상세 요청 수백~수천 건 폭주 시 차단(HTML). 부분 수집됨(드래프터 103·더스크랙 151·아이리스 27). 대응: 시간 분산(일별 Timer 누적)·curl-impersonate/프록시·또는 SerpApi(유료·안정) 검토
- [ ] (후속) 크롤 형식 변경 모니터링

### 일별 조회수 추적 (YouTube API 조사 + 구현 계획)

- [x] **API 조사** — YouTube Data API v3 **전체 20개 리소스** 확인. 조회수·좋아요를 주는 건 `Videos` 하나뿐(`videos.list?part=statistics`·신규 `batchGetStats` 둘 다 **현재 누적만**, 일별 이력 없음). Analytics API(`dimensions=day` 시계열)는 **소유자 OAuth 전용**(API 키 401)이라 경쟁사 영상 불가 → 실측 확인
- [x] **결론** — 경쟁사 영상의 일별 조회수/좋아요를 주는 공개 API 없음. **매일 누적 스냅샷 → 전일 대비 delta 로 자체 시계열 구축**이 유일한 방법(수집 시작 이후만, 과거 백필 불가)
- [x] **이미 구현됨** — `collectViewCounts`(일별 Timer)+`collectAdDetail`(수집 시 즉시) 로 `ad_metrics` 일별 스냅샷(조회수+좋아요), 상세 페이지 일별 증가량 꺾은선 그래프
- [x] **좋아요(likeCount) 수집·표시** — 어댑터가 `statistics.likeCount` 를 함께 조회, `ad_metrics.yt_like_count` 에 스냅샷. 상세 페이지에 **총 좋아요** 행 + **일별 좋아요 증가량** 꺾은선 그래프 추가(비공개 좋아요 영상은 값 없음 안내)
- [ ] **보강 계획**:
  - [x] 영상 `publishedAt`(게시일) 저장 — YouTube `part=snippet,statistics` 로 함께 수집, `ads.published_at` 컬럼(마이그레이션 0001). 기존 광고 백필 완료(278건). **최신순 정렬을 게시일 기준으로 변경**(폴백: 게재시작일→수집시각)
  - [ ] 스냅샷 간격 보정 — 스냅샷이 며칠 걸러 있으면 `delta ÷ 경과일수 = 일평균`으로 정규화 표시
  - [ ] 일별 스냅샷 신뢰성 — Azure Timer 매일 1회 전체 youtube 광고 스냅샷, 실패·누락 모니터링(collection_runs)
  - [ ] (선택) 한계 UI 안내("수집 시작일부터의 일별 조회수")

### 조회·관리 화면

- [x] Next.js 14 앱 스캐폴딩 (App Router, `next dev`, transpilePackages `@adref/core`)
- [x] 레퍼런스 리스트(메인): 카드 그리드, 정렬(최신/조회수/좋아요/게재기간), 경쟁사·형식·조회수·게재기간 필터, YouTube 썸네일
- [x] 광고 상세: YouTube 임베드 재생, 게재 기간·랜딩 URL·총 조회수·총 좋아요, 일별 조회수/좋아요 증가량 꺾은선 그래프(→ 아래 "추가 개선" 참조)
- [x] 수집 현황: 최근 실행 이력, 이번 달 API 사용량(예산 대비 %) 게이지
- [x] 로컬 개발용 목 인증(`AUTH_MODE=mock`) — Azure 는 Easy Auth 헤더(`x-ms-client-principal-name`) 읽도록 설계
- [x] DB 직접 조회 계층(`lib/queries.ts`) — 수집기=쓰기, 대시보드=읽기
- [x] **로컬 실동작 검증** — Docker PG 라이브 데이터로 4개 페이지 렌더(200), Next 빌드 8라우트 통과, 타입체크·35 테스트 통과
- [ ] 썸네일 Blob 직접 서빙 (현재 MVP 는 YouTube 썸네일 URL 사용, Blob 캐시 서빙은 후속)

### 대시보드 추가 개선 (사용자 요청)

- [x] **레퍼런스 경쟁사별 섹션 구분** — 경쟁사별로 광고를 묶어 섹션 표시(동명 구분 위해 competitorId 기준), 섹션 헤더에 광고 수·"이 경쟁사만 보기"
- [x] **조회수 범위 필터** — 전체/1천+/1만+/10만+/100만+ (최신 조회수 하한, 일반·베스트 공통)
- [x] **일간/주간/월간 베스트** — 기간 내 조회수 증가량(growth) 순위(스냅샷 차이, 이력 부족 시 총 조회수 폴백), 순위 배지·▲증가량 표시
- [x] **상세 페이지 개선** — "최신 조회수"→"총 조회수" 표기 변경, 하단 조회수 성장을 **일별 증가량 꺾은선 그래프(SVG)**로 변경(막대 → 라인, 해당일 증가분만)
- [x] **"지금 수집" 비동기화** — collect-requests 큐 + collectRequestProcessor 로 백그라운드 실행(페이지 이동해도 완료), 즉시 202 반환, 기본 상한 maxTotal=100
- [x] **표 갱신 버그 수정** — Drizzle 상관 서브쿼리 ${col}→"id" 한정자 누락으로 광고 수·조회수가 0/null 이던 버그를 리터럴 SQL 로 수정, GET route force-dynamic + 5초 폴링
- [x] **수집 시점 조회수 확보** — collectAdDetail 이 상세 저장 후 조회수도 즉시 스냅샷(일별 Timer 대기 제거)
- [x] **공유 영상 조회수 누락 버그 수정** — 여러 광고가 같은 youtube_video_id 를 재사용할 때 조회수 수집기가 `영상ID→광고ID` 단일 Map 이라 영상당 한 광고만 스냅샷되던 버그. `영상ID→광고ID[]` 배열로 바꿔 공유 영상의 모든 광고에 적재(누락 5→0). (원인은 비공개/삭제가 아니라 이 중복 제거 버그였음). youtube_video_id 없는 광고(비-YouTube)는 원천적으로 조회수 미수집
- [x] **좋아요(likeCount) 표시** — 상세 페이지에 "총 좋아요" 행 + "일별 좋아요 증가량" 꺾은선 그래프, 목록 카드 썸네일 하단에 👍 좋아요 수(좋아요 비공개 영상은 미표시). 수집·저장은 기존 구현 재사용(`ad_metrics.yt_like_count`)
- [x] **좋아요순 정렬** — 목록 정렬에 "좋아요순"(latestLikes desc) 추가(최신/조회수/좋아요/게재기간)
- [x] **게재 기간 필터** — "언제부터~언제까지" 날짜 범위 입력(네이티브 date input: 캘린더 선택+직접 입력). 게재 기간이 범위와 **겹치는** 광고 필터(null 게재일은 열린 구간). 일반·베스트 공통, 다른 필터와 조합 유지
- [x] **조회수 미확인 영상 숨김** — 최신 스냅샷 조회수가 없는 광고(비-YouTube·비공개·삭제)를 목록에서 제외(`latestViews IS NOT NULL`). 비파괴(데이터 보존 → 이후 조회수 잡히면 자동 재노출), 베스트 뷰는 기존부터 제외됨
- [x] **수집 스코프 전체 확장(텍스트·이미지 포함)** — `COLLECT_FORMATS` env(video/all)로 제어, `isFormatAllowed` 헬퍼로 수집기·대시보드 공통 필터(되돌리기=env만 변경). `ads.image_url`·`headline` 컬럼 추가(마이그레이션 0002). 어댑터(SerpApi `c.image`, 크롤/확장 best-effort 이미지·헤드라인 추출), ingest·collectAdDetail 저장, 대시보드 카드·상세(이미지 표시·텍스트 headline·비디오만 조회수/그래프) 반영. **조사 결론: 텍스트/이미지 광고는 조회수·클릭수 없음**(투명성 센터는 상업광고 engagement 미공개, 정치광고만 노출·비용 range). 테스트 6건
- [x] **브라우저 확장 수집(봇 차단 회피)** — 서버 직접 크롤이 Google `/sorry`(비정상 트래픽)에 막혀, 실제 사용자 Chrome 의 first-party 요청으로 수집하는 MV3 확장(`tools/chrome-extension/`) 구현. 백엔드 `POST /api/ingest`·`/api/known`·`GET /api/advertisers`(CORS), `ingestCreatives` 핸들러(멱등 upsert + YouTube 스냅샷, 비디오만). 신규만 상세 요청·차단 감지 자동 중단. 테스트 4건
- [x] **최신순 = 영상 게시일 기준** — 기존 최신순은 수집 시각(collectedAt) 기준이었음. YouTube `snippet.publishedAt` 을 `ads.published_at` 에 저장(수집 시 collectAdDetail·일별 collectViewCounts 백필)하고, 최신순을 `coalesce(published_at, first_shown, collected_at)` desc 로 정렬. 마이그레이션 0001, 기존 278건 백필

- [x] **광고 구성요소 저장 + 완성 광고 재현** — 투명성 센터 광고 = 배너+로고+headline+description+CTA 조합. `description`·`cta_text`(0003)·`logo_url`(0004) 컬럼, content.js 추출 2계열(adData JSON `fieldValue` + **HTML 마크업 템플릿** `componentsFromHtmlTemplate`: title/body 클래스·btnClk 앵커·adurl·정사각 소형 bg 로고). 상세 페이지에서 흰 배경 광고 카드로 조합 렌더링. 미리보기 URL 은 모든 variation 에서 탐색(이미지 광고는 variation[0] 이 정적 img HTML)
- [x] **대안(variation) 전량 수집 + 스크린샷** — `ad_variations` 테이블(0005: 대안별 width/height·문구·CTA·로고·랜딩·screenshot bytea). 이미지·텍스트는 대안 전부(≤6), 비디오는 조기 중단. 확장 "스크린샷 수집": 광고 페이지 탭을 열어 렌더 대기(~6초) 후 대안 iframe 별 captureVisibleTab+크롭 → `POST /api/screenshot` → 상세 페이지 "대안" 섹션(스크린샷=원본 픽셀, 없으면 조합 카드)

## 추가 목표 (2026-07-30)

- [x] **회원가입 + 광고 즐겨찾기** — 이메일 회원가입(허용 도메인: `nizcorp.com`·`shaperon.com` 만, 서버 검증)·로그인·로그아웃(scrypt 해시 + DB 세션 httpOnly 쿠키, 외부 의존성 없음. 마이그레이션 0007: `users`·`user_sessions`·`ad_favorites`). 카드·상세 ♥ 토글(비로그인 시 로그인 유도), 목록 "♥ 즐겨찾기만" 필터, 헤더 로그인 상태 표시

## Phase 3 — 로컬 통합 테스트 ✅ 게이트 통과 (2026-07-31, 수동 검증)

- [x] 실제 SerpApi/YouTube 키로 E2E 검증 (수집 → 저장 → 대시보드 조회) — Phase 0~2 에서 실 SerpApi 로 검증, 이후 크롤·확장 경로로 1,400여 건 실수집 + YouTube 실키로 조회수·좋아요·게시일 1,237건 일별 스냅샷 운용 중
- [x] 수집기 단위/통합 테스트 작성 및 통과 — vitest 77개 (core 크롤·어댑터·도메인 + functions 핸들러)
- [x] 쿼터 가드·재시도·멱등성 테스트 — quotaGuard 80% 스로틀, creative_id upsert 멱등(재수집=제자리 보강 실증), 포이즌 큐(Phase 1 검증)
- [x] 에러/실패 시나리오 점검 — 봇 차단(/sorry) 감지·중단, 상세 "결과 없음", XSRF 400, 빈 응답, 템플릿 4종 미스매치, 중복(0건) 등 실사고 기반으로 점검·수정 완료
- [x] **전체 기능 테스트 통과 확인 → Phase 4 진입 승인** — 사용자 수동 검증으로 승인 (2026-07-31)

> ✅ 게이트 통과 — Phase 4 착수.

## Phase 4 — Azure 프로비저닝

- [ ] 구독·리소스 그룹 생성 (`rg-adref-prod`, Korea Central) + 비용 경보
- [ ] Bicep 템플릿 작성: Storage Account, PostgreSQL Flexible Server, Key Vault, Function App, App Service, Application Insights
- [ ] Key Vault에 SerpApi·YouTube 키 등록
- [ ] Functions/App Service에 Managed Identity 부여 및 Key Vault 참조 설정
- [ ] Azure PostgreSQL에 스키마 마이그레이션 적용 (로컬과 동일 스크립트)
- [ ] DB 방화벽(Azure 서비스·사내 IP) 설정

## Phase 5 — Azure 배포·안정화

- [ ] GitHub Actions 파이프라인 구성 (main → Functions·App Service 자동 배포)
- [ ] Functions 배포 및 Timer/Queue Trigger 동작 확인
- [ ] Next.js 대시보드 App Service 배포
- [ ] Entra ID 앱 등록 + App Service Easy Auth 연결, 접근 허용 그룹 지정
- [ ] Application Insights 커스텀 메트릭(신규 광고 수·API 호출 수) 기록
- [ ] Azure Monitor 경보 (연속 실패·쿼터 80%) → 이메일/Slack/Teams
- [ ] 스테이징 스모크 테스트 (수집→저장→대시보드 조회)
- [ ] 운영 전환 및 Bicep 템플릿·운영 런북 문서화
