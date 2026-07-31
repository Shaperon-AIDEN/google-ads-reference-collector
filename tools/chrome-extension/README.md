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

- **쿠키·XSRF 처리(실측):** 쿠키를 보내면(`credentials: 'include'`) CAPTCHA 면제 쿠키(GOOGLE_ABUSE_EXEMPTION)로 `/sorry` 차단을 우회할 수 있지만, **anji 가 XSRF 토큰을 요구**한다 — 없으면 `400 XsrfException: XSRF token is MISSING`. 로그인 여부와 무관하게 NID 같은 쿠키만 있어도 발동한다. 그래서 확장은 **페이지에서 XSRF 토큰을 찾아 `x-framework-xsrf-token` 헤더로 함께 보내고**, 토큰을 못 찾거나 그래도 XSRF 로 거부되면 **XSRF 검사가 없는 익명 호출(`credentials: 'omit'`)로 자동 폴백**한다. 로그아웃 프로필 사용을 권장한다(로그인 쿠키가 없을수록 단순).
- **차단 해제:** 그 IP 의 브라우저에서 adstransparency.google.com 접속 → CAPTCHA 를 풀면 면제 쿠키가 발급돼 확장이 다시 동작(쿠키 전송하므로). 그래도 대량이면 재차단되니 간격을 넉넉히.
- 비공식 내부 RPC 기반 — Google이 형식을 바꾸면 조용히 깨질 수 있다(파싱 로직은 `packages/core`의 크롤 어댑터와 동일).
- **비디오 광고만** 저장(프로젝트 스코프). 이미지/텍스트는 건너뜀.
- 실제 브라우저라도 과도하게 빠르면 차단될 수 있으니 간격을 넉넉히.

## 예약 자동 수집 (로그아웃 전용 프로필)

수동 수집과 별개로, 매일 지정 시각에 전체 경쟁사를 자동 수집할 수 있다.

1. **전용 로그아웃 프로필 준비(1회):**
   ```bash
   open -na "Google Chrome" --args --user-data-dir="$HOME/.adref-chrome-profile" --no-first-run
   ```
   이 창에서 `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램 로드" → `tools/chrome-extension`.
   Google 로그인은 하지 않는다.
2. **예약 설정:** 확장 팝업 → "매일 자동 수집" 체크 + 시각 지정(기본 12:30). "지금 자동수집 테스트"로 즉시 검증.
3. **(선택) Chrome 자동 기동:** 알람은 이 프로필의 Chrome 이 켜져 있어야 발화한다. `launchd/com.adref.autocollect.plist` 를 설치하면 매일 12:20 에 프로필이 자동으로 열린다 (plist 안 설치 방법 참조).

- 수집 루프는 탭(content script) 안에서 돌므로 진행 중 서비스워커가 잠들어도 계속된다.
- 백엔드(`pnpm dev:functions`)가 떠 있어야 저장된다. 결과·이력은 팝업 하단 로그(최근 50건 보존)에서 확인.
