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
  return false;
});
