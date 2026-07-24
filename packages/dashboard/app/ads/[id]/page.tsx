import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAd } from '@/lib/queries';

export const dynamic = 'force-dynamic';

function fmt(n: number | null): string {
  return n == null ? '—' : n.toLocaleString();
}

export default async function AdDetailPage({ params }: { params: { id: string } }) {
  const ad = await getAd(params.id);
  if (!ad) notFound();

  const maxViews = Math.max(1, ...ad.metrics.map((m) => m.views ?? 0));

  return (
    <>
      <p><Link href="/">← 레퍼런스 목록</Link></p>
      <h1>{ad.competitorName} <span className={`badge ${ad.format}`}>{ad.format}</span></h1>

      <div className="panel">
        {ad.youtubeVideoId ? (
          <div style={{ position: 'relative', paddingTop: '56.25%' }}>
            <iframe
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, borderRadius: 8 }}
              src={`https://www.youtube.com/embed/${ad.youtubeVideoId}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <p className="muted">이 광고는 영상(YouTube)이 없습니다. 형식: {ad.format}</p>
        )}
      </div>

      <div className="panel">
        <table>
          <tbody>
            <tr><th>게재 기간</th><td>{ad.firstShown ?? '—'} ~ {ad.lastShown ?? '—'} ({ad.daysShown ?? '—'}일)</td></tr>
            <tr><th>최신 조회수</th><td>{fmt(ad.latestViews)}</td></tr>
            <tr><th>랜딩 URL</th><td>{ad.landingUrl ? <a href={ad.landingUrl} target="_blank" rel="noreferrer">{ad.landingUrl}</a> : '—'}</td></tr>
            <tr><th>랜딩 도메인</th><td>{ad.landingDomain ?? '—'}</td></tr>
            <tr><th>크리에이티브 ID</th><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{ad.creativeId}</td></tr>
          </tbody>
        </table>
      </div>

      <h2>조회수 성장 (일별 스냅샷)</h2>
      {ad.metrics.length === 0 ? (
        <p className="muted">아직 조회수 스냅샷이 없습니다. (YouTube 영상 광고만 수집됩니다)</p>
      ) : (
        <div className="panel">
          {ad.metrics.map((m) => (
            <div key={m.date} className="row" style={{ marginBottom: 6 }}>
              <span className="muted" style={{ width: 90 }}>{m.date}</span>
              <div style={{ flex: 1, background: 'var(--panel2)', borderRadius: 4, height: 18, position: 'relative' }}>
                <div style={{ width: `${((m.views ?? 0) / maxViews) * 100}%`, background: 'var(--accent)', height: '100%', borderRadius: 4 }} />
              </div>
              <span style={{ width: 90, textAlign: 'right' }}>{fmt(m.views)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
