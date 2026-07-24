'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function collectNow(row: Row) {
    setBusy(row.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/competitors/${row.id}/collect`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '수집 실패');
      setNotice(
        `'${row.name}' 수집: 신규 ${data.newAds ?? 0}건 (즉시 처리 ${data.processedInline ?? 0}, 대기 ${data.enqueued ?? 0})`,
      );
      router.refresh();
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
    router.refresh();
  }

  async function remove(row: Row) {
    if (!confirm(`'${row.name}' 경쟁사와 수집된 광고를 모두 삭제할까요?`)) return;
    setBusy(row.id);
    await fetch(`/api/competitors/${row.id}`, { method: 'DELETE' });
    setBusy(null);
    router.refresh();
  }

  if (competitors.length === 0) {
    return <div className="empty">등록된 경쟁사가 없습니다. 위에서 도메인으로 추가하세요.</div>;
  }

  return (
    <>
    {notice && <p className="muted" style={{ marginTop: 0 }}>{notice}</p>}
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
        {competitors.map((c) => (
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
                  {busy === c.id ? '수집 중…' : '지금 수집'}
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
