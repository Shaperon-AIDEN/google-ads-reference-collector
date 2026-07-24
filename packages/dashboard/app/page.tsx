import Link from 'next/link';
import { listAds, listCompetitors, type AdSort } from '@/lib/queries';

export const dynamic = 'force-dynamic'; // 항상 최신 DB 반영

function thumbUrl(youtubeVideoId: string | null): string | null {
  return youtubeVideoId ? `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg` : null;
}

function fmtViews(v: number | null): string {
  if (v == null) return '—';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return String(v);
}

export default async function ReferenceListPage({
  searchParams,
}: {
  searchParams: { sort?: string; competitor?: string; format?: string };
}) {
  const sort = (searchParams.sort as AdSort) ?? 'newest';
  const [ads, competitors] = await Promise.all([
    listAds({
      sort,
      competitorId: searchParams.competitor || undefined,
      format: (searchParams.format as 'video' | 'image' | 'text') || undefined,
    }),
    listCompetitors(),
  ]);

  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ sort, ...(searchParams.competitor ? { competitor: searchParams.competitor } : {}), ...(searchParams.format ? { format: searchParams.format } : {}), ...patch });
    return '/?' + p.toString();
  };

  return (
    <>
      <h1>레퍼런스 광고 <span className="muted">({ads.length})</span></h1>

      <div className="toolbar">
        <span className="muted">정렬:</span>
        {(['newest', 'views', 'duration'] as AdSort[]).map((s) => (
          <Link key={s} href={qs({ sort: s })}>
            <span className={`badge ${sort === s ? 'ok' : ''}`}>
              {s === 'newest' ? '최신순' : s === 'views' ? '조회수순' : '게재기간순'}
            </span>
          </Link>
        ))}
        <span className="muted" style={{ marginLeft: 16 }}>경쟁사:</span>
        <Link href={qs({ competitor: '' })}><span className={`badge ${!searchParams.competitor ? 'ok' : ''}`}>전체</span></Link>
        {competitors.filter((c) => c.adCount > 0).map((c) => (
          <Link key={c.id} href={qs({ competitor: c.id })}>
            <span className={`badge ${searchParams.competitor === c.id ? 'ok' : ''}`}>{c.name}</span>
          </Link>
        ))}
      </div>

      {ads.length === 0 ? (
        <div className="empty">
          수집된 광고가 없습니다. <Link href="/competitors">경쟁사</Link>를 등록하면 수집이 시작됩니다.
        </div>
      ) : (
        <div className="grid">
          {ads.map((ad) => {
            const t = thumbUrl(ad.youtubeVideoId);
            return (
              <Link key={ad.id} href={`/ads/${ad.id}`} className="card">
                {t ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="thumb" src={t} alt={ad.creativeId} />
                ) : (
                  <div className="thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="muted">{ad.format}</span>
                  </div>
                )}
                <div className="body">
                  <div className="title">{ad.competitorName}</div>
                  <div className="meta">
                    <span className={`badge ${ad.format}`}>{ad.format}</span>
                    <span>👁 {fmtViews(ad.latestViews)}</span>
                    {ad.daysShown != null && <span>📅 {ad.daysShown}일</span>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
