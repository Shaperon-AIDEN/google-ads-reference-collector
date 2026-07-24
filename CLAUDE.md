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

## 규칙

- 시크릿(SerpApi·YouTube 키)은 코드/문서에 하드코딩 금지. 로컬은 `.env`/`local.settings.json`, Azure는 Key Vault.
- DB 스키마 변경은 로컬·Azure 공용 마이그레이션 스크립트로만 반영한다 (`schema.ts` 수정 → `db:generate` → `migrate`).
- 수집기는 멱등 설계(`creative_id` upsert, `ad_metrics` 스냅샷 이력 보존), raw jsonb 보존, 쿼터 가드를 유지한다.
- `@adref/core` barrel(`index.ts`)에는 `import.meta` 의존 모듈(`migrate.ts`)을 export 하지 않는다 (CJS 소비 시 깨짐).

## SerpApi 실측 메모 (2026-07)

- **필드 매핑:** 목록은 `ad_creative_id`·`total_days_shown`·Unix 정수 게재일, 상세는 `ad_creatives[]` 변형 배열의 `video_link`·`visible_link`. format·게재일은 **목록에만** 있어 큐 메시지로 상세 수집기에 전달한다.
- **광고주 탐색:** SerpApi 는 회사명 검색을 지원하지 않는다. `text=<도메인>`(예: `text=coupang.com`) **도메인 검색**으로만 advertiser_id 를 얻으며, 응답 `ad_creatives[].advertiser_id`·`advertiser` 에서 추출한다. 한 도메인에 **여러 광고주**(본사·해외지사·대행사)가 나오므로 자동 확정 금지 — 대시보드에서 후보를 사용자가 선택한다(PROJECT.md §4.5).
- **region:** SerpApi 는 ISO 코드("KR")를 거부하고 **숫자 geo target 코드**를 요구한다(KR=2410, US=2840). `serpapi.ts` 의 `toSerpApiRegion` 이 매핑하며, DB `competitors.region` 은 ISO 코드로 유지한다.
- **DB 배열 컬럼:** `text[]`(예: `platforms`) 필터는 raw `ANY(${array})` 대신 Drizzle `inArray()` 를 쓴다 (배열 리터럴 직렬화 오류 방지).
- **Azurite:** Azure SDK 최신 API 버전 미지원 시 `--skipApiVersionCheck` 필요 (docker-compose 반영됨).
