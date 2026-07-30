const $ = (id) => document.getElementById(id);
const DEFAULTS = { ingestBase: 'http://localhost:7071/api', num: 40, delayMs: 3000, region: 'KR', flushEvery: 5, detailWaitMs: 6000 };

function log(msg) {
  const el = $('log');
  el.textContent += (el.textContent ? '\n' : '') + msg;
  el.scrollTop = el.scrollHeight;
}

// 설정 로드/저장
chrome.storage.local.get(['cfg'], ({ cfg }) => {
  const c = { ...DEFAULTS, ...(cfg || {}) };
  $('ingestBase').value = c.ingestBase;
  $('num').value = c.num;
  $('delayMs').value = c.delayMs;
  $('region').value = c.region;
  $('flushEvery').value = c.flushEvery;
  $('detailWaitMs').value = c.detailWaitMs;
});
function readCfg() {
  const cfg = {
    ingestBase: $('ingestBase').value.trim() || DEFAULTS.ingestBase,
    num: Number($('num').value) || 40,
    delayMs: Number($('delayMs').value) || 3000,
    region: $('region').value.trim() || 'KR',
    flushEvery: Number($('flushEvery').value) || 5,
    // 이미지·텍스트 상세 수집 시 RPC 후 대기(ms) — 0 이면 대기 없음
    detailWaitMs: Number($('detailWaitMs').value) >= 0 ? Number($('detailWaitMs').value) : 6000,
  };
  chrome.storage.local.set({ cfg });
  return cfg;
}

function renderAdvertisers(list) {
  const box = $('advertisers');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<span class="muted">등록된 경쟁사가 없습니다.</span>';
    return;
  }
  for (const a of list) {
    const id = 'ad_' + a.advertiserId;
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" value="${a.advertiserId}" id="${id}" checked /> ${a.name} <span class="muted">${a.advertiserId}</span>`;
    box.appendChild(lbl);
  }
}

// 경쟁사 목록 불러오기 (백엔드)
$('load').addEventListener('click', async () => {
  const cfg = readCfg();
  const base = cfg.ingestBase.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/advertisers`);
    const data = await res.json();
    renderAdvertisers(data.advertisers || []);
    log(`경쟁사 ${(data.advertisers || []).length}개 불러옴`);
  } catch (e) {
    log('경쟁사 불러오기 실패: ' + e + ' (백엔드 주소/실행 확인)');
  }
});

// 현재 탭의 광고주 추가
$('useCurrent').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const m = tab && tab.url && tab.url.match(/\/advertiser\/(AR\d+)/);
  if (!m) return log('현재 탭에서 광고주 ID(/advertiser/AR…)를 찾지 못했습니다.');
  renderAdvertisers([{ advertiserId: m[1], name: '(현재 페이지)' }]);
  log('현재 광고주 추가: ' + m[1]);
});

// 수집 시작
$('start').addEventListener('click', async () => {
  const cfg = readCfg();
  const ids = [...document.querySelectorAll('#advertisers input:checked')].map((i) => i.value);
  if (!ids.length) return log('수집할 광고주를 선택하세요.');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/adstransparency\.google\.com\//.test(tab.url || '')) {
    return log('먼저 adstransparency.google.com 탭을 열고 그 탭에서 실행하세요.');
  }
  log(`수집 시작: ${ids.length}개 광고주 (간격 ${cfg.delayMs}ms)`);
  chrome.tabs.sendMessage(tab.id, { type: 'collect', advertiserIds: ids, cfg }, () => {
    if (chrome.runtime.lastError) log('오류: ' + chrome.runtime.lastError.message + ' (탭 새로고침 후 재시도)');
  });
});

// 진행 상황 수신
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'progress') return;
  if (msg.phase === 'done') {
    log('=== 완료 ===');
    for (const r of msg.results || []) {
      if (r.error) log(`  ${r.advertiserId}: 오류 ${r.error}`);
      else {
        const saved = r.saved ? (r.saved.saved ?? '?') : 0;
        const err = r.saved && r.saved.error ? ` (일부 저장실패: ${r.saved.error})` : '';
        log(`  ${r.advertiserId}: 전체 ${r.total} / 신규 ${r.fresh} / 저장 ${saved}${r.blocked ? ' [차단중단]' : ''}${err}`);
      }
    }
  } else {
    log(`[${msg.phase}] ${msg.advertiserId || ''} ${msg.message || ''}`);
  }
});
