// 서비스 워커 — 확장 권한으로 cross-origin fetch 수행 (content script 는 CORS 제약을 받으므로).
// - fetchText: 광고 미리보기 content.js (googlesyndication 등) 가져오기 → YouTube ID/랜딩 추출용
// - post/get: 백엔드(ingest/known/advertisers) 호출
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'fetchText') {
    fetch(msg.url, { credentials: 'omit' })
      .then((r) => r.text())
      .then((text) => sendResponse({ ok: true, text }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async
  }
  if (msg?.type === 'imageSize') {
    // 이미지 URL 의 실제 픽셀 크기 측정 (로고=정사각/작음 vs 광고=배너 구분용). 서비스워커에서 createImageBitmap.
    fetch(msg.url, { credentials: 'omit' })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('http ' + r.status))))
      .then((b) => createImageBitmap(b))
      .then((bmp) => sendResponse({ ok: true, w: bmp.width, h: bmp.height }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async
  }
  if (msg?.type === 'post') {
    fetch(msg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(msg.body),
    })
      .then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))
      .then((res) => sendResponse({ ok: res.status >= 200 && res.status < 300, ...res }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === 'get') {
    fetch(msg.url)
      .then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))
      .then((res) => sendResponse({ ok: res.status >= 200 && res.status < 300, ...res }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === 'autoSchedule') {
    scheduleAuto(msg.enabled, msg.time)
      .then((info) => sendResponse({ ok: true, ...info }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === 'autoRunNow') {
    runAutoCollect('수동 테스트');
    sendResponse({ ok: true, started: true });
    return false;
  }
  if (msg?.type === 'autoStatus') {
    Promise.all([chrome.storage.local.get(['autoLog', 'autoCfg']), chrome.alarms.get(AUTO_ALARM)])
      .then(([st, alarm]) =>
        sendResponse({
          ok: true,
          log: st.autoLog || [],
          cfg: st.autoCfg || null,
          nextRun: alarm ? new Date(alarm.scheduledTime).toLocaleString('ko-KR') : null,
        }),
      )
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});

// ===== 예약 자동 수집 (chrome.alarms) =====
// 매일 지정 시각에 투명성 센터 탭을 찾거나(없으면 열고) content script 에 전체 경쟁사 수집을
// 위임한다. 수집 루프는 탭(content script) 안에서 돌므로 서비스워커가 중간에 잠들어도 계속된다.
// ⚠️ Chrome(이 프로필)이 켜져 있어야 알람이 발화한다 — 로그아웃 전용 프로필 + 자동 기동은 README 참조.

const AUTO_ALARM = 'autoCollect';
const AUTO_CFG_DEFAULTS = { ingestBase: 'http://localhost:7071/api', num: 40, delayMs: 3000, region: 'KR', flushEvery: 5 };

async function autoLog(message) {
  const { autoLog: log = [] } = await chrome.storage.local.get('autoLog');
  log.push(`[${new Date().toLocaleString('ko-KR')}] ${message}`);
  await chrome.storage.local.set({ autoLog: log.slice(-50) });
}

// HH:MM(로컬) 의 다음 발생 시각(ms) — 오늘 시각이 지났으면 내일
function nextOccurrence(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

async function scheduleAuto(enabled, time) {
  await chrome.alarms.clear(AUTO_ALARM);
  await chrome.storage.local.set({ autoCfg: { enabled, time } });
  if (!enabled || !/^\d{1,2}:\d{2}$/.test(time || '')) {
    await autoLog('자동 수집 예약 해제');
    return { nextRun: null };
  }
  const when = nextOccurrence(time);
  chrome.alarms.create(AUTO_ALARM, { when, periodInMinutes: 1440 });
  const nextRun = new Date(when).toLocaleString('ko-KR');
  await autoLog(`자동 수집 예약: 매일 ${time} (다음 실행 ${nextRun})`);
  return { nextRun };
}

// 브라우저 재시작 시 저장된 예약 복원 (알람은 프로필에 남지만 안전하게 재설정)
chrome.runtime.onStartup?.addListener(async () => {
  const { autoCfg } = await chrome.storage.local.get('autoCfg');
  if (autoCfg?.enabled && autoCfg.time) scheduleAuto(true, autoCfg.time);
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === AUTO_ALARM) runAutoCollect('예약');
});

const sleepAuto = (ms) => new Promise((r) => setTimeout(r, ms));

async function pingTab(tabId, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
      if (res && res.ok) return true;
    } catch {}
    await sleepAuto(500);
  }
  return false;
}

async function runAutoCollect(reason) {
  const { cfg: saved = {} } = await chrome.storage.local.get('cfg');
  const cfg = { ...AUTO_CFG_DEFAULTS, ...saved };
  const base = cfg.ingestBase.replace(/\/$/, '');

  let advertisers = [];
  try {
    advertisers = (await (await fetch(`${base}/advertisers`)).json()).advertisers || [];
  } catch (e) {
    return autoLog(`자동 수집(${reason}) 실패: 백엔드 연결 불가 (${e})`);
  }
  if (!advertisers.length) return autoLog(`자동 수집(${reason}): 등록된 경쟁사 없음`);

  // 투명성 센터 탭 확보 (기존 탭 재사용, 없으면 백그라운드로 열기)
  let tabs = await chrome.tabs.query({ url: 'https://adstransparency.google.com/*' });
  let tab = tabs[0];
  if (!tab) tab = await chrome.tabs.create({ url: 'https://adstransparency.google.com/?region=KR', active: false });

  if (!(await pingTab(tab.id))) return autoLog(`자동 수집(${reason}) 실패: 탭 준비 안 됨`);

  await autoLog(`자동 수집(${reason}) 시작: 경쟁사 ${advertisers.length}개 (간격 ${cfg.delayMs}ms)`);
  chrome.tabs.sendMessage(tab.id, { type: 'collect', advertiserIds: advertisers.map((a) => a.advertiserId), cfg }, (res) => {
    if (chrome.runtime.lastError) {
      autoLog(`자동 수집(${reason}) 오류: ${chrome.runtime.lastError.message}`);
      return;
    }
    const parts = (res?.results || []).map((r) =>
      r.error
        ? `${r.advertiserId}: 오류`
        : `${r.advertiserId}: 전체 ${r.total}/신규 ${r.fresh}/저장 ${r.saved?.saved ?? 0}${r.blocked ? ' [차단]' : ''}`,
    );
    autoLog(`자동 수집(${reason}) 완료 — ${parts.join(' · ') || '결과 없음'}`);
  });
}
