'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Row {
  id: string;
  name: string;
  advertiserId: string;
  domain: string | null;
  region: string;
  isActive: boolean;
  adCount: number;
}

export default function CompetitorList({ competitors }: { competitors: Row[] }) {
  const [rows, setRows] = useState<Row[]>(competitors);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 수집을 트리거한 시각 — 이후 일정 시간 동안 표를 폴링해 광고 수를 라이브 갱신
  const collectingUntil = useRef<number>(0);

  // 서버가 새 props 를 주면 반영 (네비게이션 복귀 시)
  useEffect(() => setRows(competitors), [competitors]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/competitors', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.competitors)) setRows(data.competitors);
      }
    } catch {
      /* 폴링 실패는 조용히 무시 */
    }
  }, []);

  // 수집 트리거 후 ~2분간 5초 주기로 표를 갱신 (백그라운드 수집이 진행되며 광고 수가 늘어남)
  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() < collectingUntil.current) refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function collectNow(row: Row) {
    setBusy(row.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/competitors/${row.id}/collect`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 202) throw new Error(data.error ?? '수집 시작 실패');
      // 백그라운드 큐에 적재됨 — 페이지를 벗어나도 수집은 완료된다
      setNotice(`'${row.name}' 수집을 시작했습니다. 진행되며 광고 수가 자동 갱신됩니다.`);
      collectingUntil.current = Date.now() + 120_000; // 2분간 폴링
      setTimeout(refresh, 2000);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(row: Row) {
    setBusy(row.id);
    await fetch(`/api/competitors/${row.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: !row.isActive }),
    });
    setBusy(null);
    refresh();
  }

  async function remove(row: Row) {
    if (!confirm(`'${row.name}' 경쟁사와 수집된 광고를 모두 삭제할까요?`)) return;
    setBusy(row.id);
    await fetch(`/api/competitors/${row.id}`, { method: 'DELETE' });
    setBusy(null);
    refresh();
  }

  if (rows.length === 0) {
    return <div className="empty">등록된 경쟁사가 없습니다. 위에서 회사명 또는 도메인으로 추가하세요.</div>;
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        {notice && <span className="muted">{notice}</span>}
        <button className="secondary" style={{ marginLeft: 'auto' }} onClick={refresh}>
          새로고침
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>경쟁사</th>
            <th>광고주 ID</th>
            <th>도메인</th>
            <th>지역</th>
            <th>광고 수</th>
            <th>상태</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td style={{ fontWeight: 600 }}>{c.name}</td>
              <td className="muted" style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.advertiserId}</td>
              <td className="muted">{c.domain ?? '—'}</td>
              <td>{c.region}</td>
              <td>{c.adCount}</td>
              <td>
                <span className={`badge ${c.isActive ? 'ok' : ''}`}>{c.isActive ? '수집중' : '중지'}</span>
              </td>
              <td>
                <div className="row">
                  <button disabled={busy === c.id} onClick={() => collectNow(c)}>
                    지금 수집
                  </button>
                  <button className="secondary" disabled={busy === c.id} onClick={() => toggleActive(c)}>
                    {c.isActive ? '중지' : '재개'}
                  </button>
                  <button className="secondary" disabled={busy === c.id} onClick={() => remove(c)} style={{ color: 'var(--err)' }}>
                    삭제
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
