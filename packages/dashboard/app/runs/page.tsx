import { recentRuns } from '@/lib/queries';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = { list: '목록', detail: '상세', view_count: '조회수' };

export default async function RunsPage() {
  const runs = await recentRuns(50);
  const budget = env().QUOTA_MONTHLY_BUDGET;
  const monthCalls = runs
    .filter((r) => {
      const d = new Date(r.startedAt);
      const now = new Date();
      return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
    })
    .reduce((s, r) => s + r.apiCallCount, 0);
  const pct = Math.round((monthCalls / budget) * 100);

  return (
    <>
      <h1>수집 현황</h1>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>이번 달 API 사용량</span>
          <span className={pct >= 80 ? 'badge failed' : 'badge ok'}>{monthCalls} / {budget} ({pct}%)</span>
        </div>
        <div style={{ marginTop: 8, background: 'var(--panel2)', borderRadius: 4, height: 10 }}>
          <div style={{ width: `${Math.min(100, pct)}%`, background: pct >= 80 ? 'var(--err)' : 'var(--accent)', height: '100%', borderRadius: 4 }} />
        </div>
      </div>

      <h2>최근 실행 이력</h2>
      {runs.length === 0 ? (
        <div className="empty">실행 이력이 없습니다.</div>
      ) : (
        <table>
          <thead>
            <tr><th>시각</th><th>종류</th><th>상태</th><th>신규</th><th>API 호출</th><th>오류</th></tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="muted">{new Date(r.startedAt).toLocaleString('ko-KR')}</td>
                <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
                <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                <td>{r.newAdsCount}</td>
                <td>{r.apiCallCount}</td>
                <td className="muted" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.errorMessage ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
