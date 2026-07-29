import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAd } from '@/lib/queries';

export const dynamic = 'force-dynamic';

function fmt(n: number | null): string {
  return n == null ? '—' : n.toLocaleString();
}
function fmtShort(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return String(Math.round(v));
}

/** 일별 증가량 꺾은선 그래프 (SVG, 서버 렌더) */
function DailyGrowthChart({
  points,
  color = 'var(--accent)',
  label = '일별 증가량',
}: {
  points: Array<{ date: string; delta: number }>;
  color?: string;
  label?: string;
}) {
  const W = 680;
  const H = 240;
  const padL = 52;
  const padR = 16;
  const padT = 16;
  const padB = 44;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const maxDelta = Math.max(1, ...points.map((p) => p.delta));
  const x = (i: number) => (points.length <= 1 ? padL + innerW / 2 : padL + (i / (points.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / maxDelta) * innerH;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.delta).toFixed(1)}`).join(' ');

  // Y축 눈금 3단계
  const ticks = [0, 0.5, 1].map((f) => Math.round(maxDelta * f));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label={label}>
      {/* Y축 눈금·격자 */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
            {fmtShort(t)}
          </text>
        </g>
      ))}
      {/* 증가량 라인 */}
      <path d={line} fill="none" stroke={color} strokeWidth="2" />
      {/* 점 + 값 라벨 + 날짜 */}
      {points.map((p, i) => (
        <g key={p.date}>
          <circle cx={x(i)} cy={y(p.delta)} r="3.5" fill={color} />
          <text x={x(i)} y={y(p.delta) - 8} textAnchor="middle" fontSize="11" fill="var(--text)">
            ▲{fmtShort(p.delta)}
          </text>
          <text x={x(i)} y={H - padB + 18} textAnchor="middle" fontSize="10" fill="var(--muted)">
            {p.date.slice(5)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default async function AdDetailPage({ params }: { params: { id: string } }) {
  const ad = await getAd(params.id);
  if (!ad) notFound();

  // 일별 증가량 = 해당 스냅샷 조회수 − 직전 스냅샷 조회수 (음수 방지)
  const deltas: Array<{ date: string; delta: number }> = [];
  for (let i = 1; i < ad.metrics.length; i++) {
    const prev = ad.metrics[i - 1]!.views ?? 0;
    const cur = ad.metrics[i]!.views ?? 0;
    deltas.push({ date: ad.metrics[i]!.date, delta: Math.max(0, cur - prev) });
  }

  // 좋아요: 총 좋아요(최신 스냅샷) + 일별 증가량 (조회수와 동일 원리)
  const latestLikes = [...ad.metrics].reverse().find((m) => m.likes != null)?.likes ?? null;
  const likeDeltas: Array<{ date: string; delta: number }> = [];
  for (let i = 1; i < ad.metrics.length; i++) {
    const prev = ad.metrics[i - 1]!.likes ?? 0;
    const cur = ad.metrics[i]!.likes ?? 0;
    likeDeltas.push({ date: ad.metrics[i]!.date, delta: Math.max(0, cur - prev) });
  }

  return (
    <>
      <p><Link href="/">← 레퍼런스 목록</Link></p>
      <h1>{ad.competitorName} <span className={`badge ${ad.format}`}>{ad.format}</span></h1>

      <div className="panel">
        {ad.headline && ad.format !== 'video' && (
          <p style={{ fontSize: 16, fontWeight: 600, marginTop: 0 }}>{ad.headline}</p>
        )}
        {ad.youtubeVideoId ? (
          // 비디오(YouTube): 임베드 재생
          <div style={{ position: 'relative', paddingTop: '56.25%' }}>
            <iframe
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, borderRadius: 8 }}
              src={`https://www.youtube.com/embed/${ad.youtubeVideoId}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : ad.imageUrl ? (
          // 이미지 광고: 크리에이티브 이미지 표시
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.imageUrl} alt={ad.headline ?? ad.creativeId} style={{ maxWidth: '100%', borderRadius: 8 }} />
        ) : (
          // 비-YouTube 영상·텍스트·이미지 미확보: 원본 링크로 안내
          <div>
            <p className="muted">
              {ad.format === 'video'
                ? 'YouTube 외 영상은 원본 링크로 확인합니다 (스트림 URL 은 만료될 수 있음).'
                : '이 광고의 미리보기는 투명성 센터 원본에서 확인합니다.'}
            </p>
            <div className="row">
              <a
                href={`https://adstransparency.google.com/advertiser/${ad.advertiserId}/creative/${ad.creativeId}`}
                target="_blank"
                rel="noreferrer"
              >
                <button>투명성 센터에서 보기 ↗</button>
              </a>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <table>
          <tbody>
            <tr><th>게재 기간</th><td>{ad.firstShown ?? '—'} ~ {ad.lastShown ?? '—'} ({ad.daysShown ?? '—'}일)</td></tr>
            {ad.format === 'video' && <tr><th>총 조회수</th><td>{fmt(ad.latestViews)}</td></tr>}
            {ad.format === 'video' && <tr><th>총 좋아요</th><td>{fmt(latestLikes)}</td></tr>}
            <tr><th>랜딩 URL</th><td>{ad.landingUrl ? <a href={ad.landingUrl} target="_blank" rel="noreferrer">{ad.landingUrl}</a> : '—'}</td></tr>
            <tr><th>랜딩 도메인</th><td>{ad.landingDomain ?? '—'}</td></tr>
            <tr><th>크리에이티브 ID</th><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{ad.creativeId}</td></tr>
            <tr>
              <th>투명성 센터</th>
              <td>
                <a
                  href={`https://adstransparency.google.com/advertiser/${ad.advertiserId}/creative/${ad.creativeId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  원본 광고 보기 ↗
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {ad.format === 'video' && (
        <>
          <h2>일별 조회수 증가량</h2>
          {deltas.length === 0 ? (
            <p className="muted">
              {ad.metrics.length === 0
                ? '아직 조회수 스냅샷이 없습니다. (YouTube 영상 광고만 조회수가 수집됩니다)'
                : '일별 증가량은 조회수 스냅샷이 2개 이상 쌓이면 표시됩니다. (매일 자동 수집으로 누적)'}
            </p>
          ) : (
            <div className="panel">
              <DailyGrowthChart points={deltas} label="일별 조회수 증가량" />
            </div>
          )}

          <h2>일별 좋아요 증가량</h2>
          {likeDeltas.length === 0 || likeDeltas.every((p) => p.delta === 0) ? (
            <p className="muted">
              {ad.metrics.length < 2
                ? '일별 좋아요 증가량은 스냅샷이 2개 이상 쌓이면 표시됩니다. (매일 자동 수집으로 누적)'
                : '집계 기간 동안 좋아요 증가가 없습니다. (좋아요 비공개 영상은 표시되지 않을 수 있음)'}
            </p>
          ) : (
            <div className="panel">
              <DailyGrowthChart points={likeDeltas} color="#e0245e" label="일별 좋아요 증가량" />
            </div>
          )}
        </>
      )}

      {ad.format !== 'video' && (
        <p className="muted" style={{ fontSize: 13 }}>
          텍스트·이미지 광고는 조회수·좋아요 지표를 제공하지 않습니다 (투명성 센터·YouTube 모두 상업 광고의 조회/클릭 수를 공개하지 않음).
        </p>
      )}
    </>
  );
}
