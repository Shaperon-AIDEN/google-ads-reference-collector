# Google Ads Reference Collector

경쟁사 구글 광고(비디오·이미지·텍스트) 레퍼런스를 자동 수집해 PostgreSQL 에 저장하고, Next.js 대시보드로 조회·분석하는 시스템.

- 광고 소스: Google 광고 투명성 센터 (SerpApi 또는 직접 크롤, `ADS_SOURCE` 로 전환)
- 조회수·좋아요: YouTube Data API v3 (일별 스냅샷 → 증가량 추세)
- 수집 경로: 서버 크롤(Azure Functions) + **Chrome 확장**(브라우저 first-party — 봇 차단 회피, 대량 수집용)
- 상세 설계: [PROJECT.md](./PROJECT.md) · 진행 현황: [TODO.md](./TODO.md) · 작업 규칙·실측 노트: [CLAUDE.md](./CLAUDE.md)

## 구조 (pnpm 모노레포)

```
packages/
├── core/        # @adref/core — DB 스키마(Drizzle)·마이그레이션·어댑터(SerpApi/크롤/YouTube/큐/Blob)·도메인
├── functions/   # 수집기 — Azure Functions v4 (Timer/Queue/HTTP), 로컬은 Functions Core Tools
└── dashboard/   # 대시보드 — Next.js 14 App Router (DB 직접 조회, 회원/즐겨찾기 포함)
tools/chrome-extension/   # 수집용 Chrome 확장 (MV3)
scripts/                  # 시드·백필·이관 등 유틸리티
infra/bicep/              # Azure 리소스 IaC
```

## 로컬 설치·구동

### 사전 요구사항

| 도구 | 버전 | 비고 |
|---|---|---|
| Node.js | 20 | |
| pnpm | 9 (`corepack enable` 권장) | 프로젝트 고정 버전 사용 |
| Docker | - | PostgreSQL 16 + Azurite 컨테이너 |
| Azure Functions Core Tools | 4 | `packages/functions` devDependency 로 설치됨 |

### 1) 의존성 설치·인프라 기동

```bash
git clone <이 저장소>
cd google-ads-reference-collector
pnpm install
pnpm compose:up          # PostgreSQL 16 (localhost:5432, DB=adref) + Azurite
```

### 2) 환경 변수

```bash
cp .env.example .env
cp packages/functions/local.settings.json.example packages/functions/local.settings.json
```

두 파일에 공통으로 채울 값:

| 키 | 값 |
|---|---|
| `DATABASE_URL` | `postgres://adref:adref@localhost:5432/adref` |
| `SERPAPI_KEY` | SerpApi 키 (크롤 모드만 쓰면 생략 가능) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 키 (조회수·좋아요 수집) |
| `ADS_SOURCE` | `crawl`(무료·비공식) 또는 `serpapi`(안정·유료) |
| `COLLECT_FORMATS` | `all` (비디오만 수집하려면 `video`) |

시크릿은 코드에 하드코딩하지 않는다 — 두 파일 모두 gitignore 대상.

### 3) 스키마 적용·빌드

```bash
pnpm migrate             # drizzle 마이그레이션 0000~ 전체 적용 (pgcrypto 포함)
pnpm -C packages/core build
```

### 4) 실행

```bash
pnpm dev:functions       # 수집기 (http://localhost:7071) — Timer/Queue/HTTP 트리거
pnpm dev:dashboard       # 대시보드 (http://localhost:3000)
```

- 대시보드 → **경쟁사 관리**에서 회사명/도메인으로 광고주를 검색·등록 → "지금 수집"
- 회원가입은 허용 도메인(`nizcorp.com`·`shaperon.com`) 이메일만 가능

### 5) Chrome 확장 (대량 수집 권장 경로)

서버(데이터센터 IP) 크롤은 대량 수집 시 구글 봇 차단에 걸리기 쉽다. 수백 건 이상은 확장으로:

1. `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램 로드" → `tools/chrome-extension`
2. https://adstransparency.google.com 탭을 열고 확장 팝업에서 **백엔드 주소**(로컬 `http://localhost:7071/api`) 확인 → "경쟁사 불러오기" → "수집 시작"
3. 기본 정책: 요청 간격 3000ms · 연속 500건마다 10분 휴식 후 자동 재개 · 차단 감지 시 자동 중단(백로그 보존 — 다음 실행이 이어서)

자세한 사용법: [tools/chrome-extension/README.md](./tools/chrome-extension/README.md)

### 테스트

```bash
pnpm test                # vitest — core(어댑터·크롤 파싱·도메인) + functions(핸들러) 86+
```

## Azure 배포 (운영)

`main` 병합 시 GitHub Actions(`.github/workflows/deploy.yml`)가 테스트 → Function App(수집기) → App Service(대시보드) 순으로 자동 배포한다. 리소스는 `infra/bicep/main.bicep` (Storage·PostgreSQL Flexible·Key Vault·Functions·App Service·App Insights). 상세는 CLAUDE.md "Azure 운영" 절 참조.
