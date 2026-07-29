# Ad Reference Collector — Chrome 확장

Google 광고 투명성 센터를 **실제 브라우저 세션(사용자 Chrome)**에서 수집해 백엔드(`/api/ingest`)로 전송한다.
서버가 데이터센터 IP로 직접 크롤하면 `google.com/sorry`(봇 차단)에 막히지만, 사람이 쓰는 브라우저의
first-party 요청은 차단을 회피한다.

## 동작 원리

1. **content.js** (adstransparency.google.com 페이지 컨텍스트): `SearchCreatives`(목록)·`GetCreativeById`(상세)를
   **same-origin**으로 호출 → 실제 세션이라 `/sorry` 회피. 미리보기 `content.js`에서 YouTube ID·랜딩 URL 추출.
2. **background.js** (서비스 워커): content script가 못 하는 cross-origin 요청(미리보기 fetch, 백엔드 POST)을 확장 권한으로 대행.
3. 이미 저장된 크리에이티브는 `/api/known`으로 걸러 **신규만 상세 요청**(요청 수·차단 위험 최소화).
4. **popup**: 경쟁사 선택·설정·진행 표시.

수집 데이터는 백엔드가 저장(멱등 upsert) + YouTube Data API로 조회수·좋아요·게시일 스냅샷(서버 측, 무료).

## 백엔드 준비

Functions 호스트가 떠 있어야 한다(`/api/ingest`, `/api/known`, `/api/advertisers`).

```bash
pnpm dev:functions   # 기본 http://localhost:7071
```

- 브라우저와 **같은 머신**에서 Functions 실행 → `백엔드 주소 = http://localhost:7071/api`
- **DGX**의 Functions로 보낼 때 → `http://192.168.0.124:7071/api` (DGX에서 `pnpm dev:functions` 실행 + LAN 접근 가능해야 함)

## 설치 (로드)

1. Chrome → `chrome://extensions`
2. 우상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드** → `tools/chrome-extension/` 폴더 선택

## 사용

1. `https://adstransparency.google.com` 아무 페이지나 연다 (로그인 불필요, 공개 데이터).
2. 확장 아이콘 클릭 → 팝업
3. **백엔드 주소** 확인 (localhost 또는 DGX)
4. **경쟁사 불러오기**(등록된 경쟁사 목록) 또는 **현재 페이지 광고주**(URL의 `/advertiser/AR…` 자동 인식)
5. 대상 체크 → **수집 시작**. 진행 로그가 팝업에 표시된다.
   - `요청 간격(ms)`: 크게 둘수록 안전(기본 1200ms + 지터). 대량이면 2000~4000ms 권장.
   - `저장 단위(건)`: 이 건수마다 DB에 즉시 저장(기본 5). **1로 두면 상세 수집마다 저장**. 작을수록 대시보드 반영이 빠르고 중단 시 손실이 적지만, 백엔드 요청·수집 실행(run) 기록이 많아진다.
   - **차단 감지 시** 그때까지 수집분을 저장하고 자동 중단(로그에 `⚠️ 차단 감지`). 점진 저장이라 이미 저장된 분은 보존된다.

> 팝업을 닫아도 해당 탭이 열려 있으면 수집은 계속되지만 진행 로그는 표시되지 않는다.
> 수집이 끝나면 대시보드에서 결과를 확인한다.

## 제한 / 주의

- **🔴 반드시 Google 에서 로그아웃한 브라우저/프로필에서 사용.** RPC 는 `credentials: 'include'` 로 호출한다 — CAPTCHA 를 풀면 받는 면제 쿠키(GOOGLE_ABUSE_EXEMPTION)를 함께 보내 `/sorry` 차단을 우회하기 위함. 단 **로그인 상태면** SAPISID 쿠키가 실려 anji 엔드포인트가 SAPISIDHASH 헤더를 요구하며 **400** 을 반환한다(content script 는 httpOnly SAPISID 를 못 읽어 해시 생성 불가). → 게스트/시크릿 창 또는 Google 로그아웃 프로필에서 실행. (로그인 상태로 실행하면 "RPC 400: 로그아웃 필요" 안내가 뜬다.)
- **차단 해제:** 그 IP 의 브라우저에서 adstransparency.google.com 접속 → CAPTCHA 를 풀면 면제 쿠키가 발급돼 확장이 다시 동작(쿠키 전송하므로). 그래도 대량이면 재차단되니 간격을 넉넉히.
- 비공식 내부 RPC 기반 — Google이 형식을 바꾸면 조용히 깨질 수 있다(파싱 로직은 `packages/core`의 크롤 어댑터와 동일).
- **비디오 광고만** 저장(프로젝트 스코프). 이미지/텍스트는 건너뜀.
- 실제 브라우저라도 과도하게 빠르면 차단될 수 있으니 간격을 넉넉히.
