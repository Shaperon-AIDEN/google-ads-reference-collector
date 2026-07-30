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
  if (msg?.type === 'screenshotRun') {
    runScreenshots(msg.cfg); // 백그라운드에서 진행 (팝업이 닫혀도 계속)
    sendResponse({ ok: true, started: true });
    return false;
  }
  return false;
});

// ===== 스크린샷 캡처 — 투명성 센터 렌더링을 대안(variation)별로 찍어 원본 픽셀 그대로 보존 =====
// 조합 렌더링으로는 광고 단위의 비율·레이아웃을 완전히 재현할 수 없어, 실제 렌더링을 캡처한다.
// 흐름: 광고 페이지 탭 열기(활성) → 렌더 대기(~6초 실측) → 대안 iframe 마다 스크롤+캡처+크롭 → 백엔드 저장.
// captureVisibleTab 은 "화면에 보이는 것"을 찍으므로 캡처 중 브라우저 창이 보여야 한다.

const sleepBg = (ms) => new Promise((r) => setTimeout(r, ms));

function progress(message) {
  try {
    chrome.runtime.sendMessage({ type: 'progress', phase: 'shot', message });
  } catch {}
}

// 전체 탭 캡처(PNG dataUrl)를 대안 iframe 영역으로 크롭 (devicePixelRatio 보정).
// blank=단색(아직 렌더 안 된 빈 영역) 여부를 함께 반환 — 호출부가 재시도/스킵 판단.
async function cropShot(dataUrl, rect, dpr) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.min(bmp.width - sx, Math.round(rect.w * dpr));
  const sh = Math.min(bmp.height - sy, Math.round(rect.h * dpr));
  if (sw <= 0 || sh <= 0) throw new Error('빈 캡처 영역');
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  // 단색 검사 — 픽셀을 듬성듬성 샘플링해 첫 픽셀과 전부 비슷하면 빈 캡처로 판정
  const d = ctx.getImageData(0, 0, sw, sh).data;
  let blank = true;
  for (let i = 0; i < d.length; i += 397 * 4) {
    if (Math.abs(d[i] - d[0]) > 8 || Math.abs(d[i + 1] - d[1]) > 8 || Math.abs(d[i + 2] - d[2]) > 8) {
      blank = false;
      break;
    }
  }
  const png = await canvas.convertToBlob({ type: 'image/png' });
  const buf = new Uint8Array(await png.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { dataUrl: 'data:image/png;base64,' + btoa(bin), blank };
}

// content script 가 준비될 때까지 재시도하며 메시지 전송
async function sendToTab(tabId, msg, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, msg);
      if (res) return res;
    } catch {}
    await sleepBg(500);
  }
  return null;
}

// 광고 1건: 페이지 열어 모든 대안 iframe 캡처
async function captureCreative(advertiserId, creativeId, cfg) {
  const url = `https://adstransparency.google.com/advertiser/${advertiserId}/creative/${creativeId}?region=${cfg.region || 'KR'}`;
  const tab = await chrome.tabs.create({ url, active: true });
  const shots = [];
  try {
    const info = await sendToTab(tab.id, { type: 'waitVariations', renderWaitMs: cfg.renderWaitMs || 6000 });
    if (!info || !info.ok) return { creativeId, error: (info && info.error) || '대안 iframe 없음' };
    for (let i = 0; i < info.count; i++) {
      try {
        // 빈 캡처(단색)면 렌더 미완료 → 4초 더 기다렸다 재캡처 (최대 3회). 끝내 비면 저장 안 함.
        let shot;
        for (let attempt = 0; attempt < 3; attempt++) {
          const r = await sendToTab(tab.id, { type: 'focusVariation', pos: i }, 4);
          if (!r || !r.ok) break;
          const full = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
          const c = await cropShot(full, r.rect, r.dpr);
          if (!c.blank) {
            shot = { idx: r.idx, width: r.width, height: r.height, dataUrl: c.dataUrl };
            break;
          }
          progress(`  대안 ${i}: 빈 캡처 — ${attempt < 2 ? '4초 후 재시도' : '스킵'}`);
          await sleepBg(4000);
        }
        if (shot) shots.push(shot);
      } catch (e) {
        progress(`  대안 ${i} 캡처 실패: ${e}`);
      }
    }
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch {}
  }
  return { creativeId, shots };
}

async function runScreenshots(cfg) {
  const base = cfg.ingestBase.replace(/\/$/, '');
  let targets = [];
  try {
    const r = await fetch(`${base}/screenshot/targets`);
    targets = (await r.json()).targets || [];
  } catch (e) {
    return progress('대상 조회 실패: ' + e + ' (백엔드 확인)');
  }
  progress(`스크린샷 대상 ${targets.length}건 (광고당 ~10초, 창을 화면에 두세요)`);
  let done = 0;
  let failed = 0;
  for (const t of targets) {
    let res;
    try {
      res = await captureCreative(t.advertiserId, t.creativeId, cfg);
    } catch (e) {
      res = { error: String(e) };
    }
    if (res.shots && res.shots.length) {
      const up = await fetch(`${base}/screenshot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ creativeId: t.creativeId, shots: res.shots }),
      })
        .then((r) => r.ok)
        .catch(() => false);
      if (up) done += 1;
      else {
        failed += 1;
        progress(`  ${t.creativeId}: 업로드 실패`);
      }
    } else {
      failed += 1;
      progress(`  ${t.creativeId}: ${res.error || '캡처 없음'}`);
    }
    progress(`캡처 진행 ${done + failed}/${targets.length} (성공 ${done}, 실패 ${failed})`);
    await sleepBg(cfg.delayMs || 3000);
  }
  progress(`=== 스크린샷 완료: 성공 ${done}, 실패 ${failed} ===`);
}
