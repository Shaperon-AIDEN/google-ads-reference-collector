import Link from 'next/link';
import { listAds, listCompetitors, type AdCard, type AdSort } from '@/lib/queries';

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

function AdCardView({ ad }: { ad: AdCard }) {
  const t = thumbUrl(ad.youtubeVideoId);
  return (
    <Link href={`/ads/${ad.id}`} className="card">
      {t ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="thumb" src={t} alt={ad.creativeId} />
      ) : (
        <div className="thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="muted">{ad.format}</span>
        </div>
      )}
      <div className="body">
        <div className="meta">
          <span className={`badge ${ad.format}`}>{ad.format}</span>
          <span>👁 {fmtViews(ad.latestViews)}</span>
          {ad.daysShown != null && <span>📅 {ad.daysShown}일</span>}
        </div>
      </div>
    </Link>
  );
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
    const p = new URLSearchParams({
      sort,
      ...(searchParams.competitor ? { competitor: searchParams.competitor } : {}),
      ...(searchParams.format ? { format: searchParams.format } : {}),
      ...patch,
    });
    return '/?' + p.toString();
  };

  // 경쟁사별로 광고를 묶는다 (동명 경쟁사 구분 위해 competitorId 기준).
  // 경쟁사 표시 순서는 광고 수집이 있는 경쟁사 목록 순서를 따른다.
  const byCompetitor = new Map<string, { name: string; ads: AdCard[] }>();
  for (const ad of ads) {
    let g = byCompetitor.get(ad.competitorId);
    if (!g) {
      g = { name: ad.competitorName, ads: [] };
      byCompetitor.set(ad.competitorId, g);
    }
    g.ads.push(ad);
  }
  const groups = [...byCompetitor.entries()].map(([id, g]) => ({ id, ...g }));

  return (
    <>
      <h1>
        레퍼런스 광고 <span className="muted">({ads.length})</span>
      </h1>

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
        <Link href={qs({ competitor: '' })}>
          <span className={`badge ${!searchParams.competitor ? 'ok' : ''}`}>전체</span>
        </Link>
        {competitors
          .filter((c) => c.adCount > 0)
          .map((c) => (
            <Link key={c.id} href={qs({ competitor: c.id })}>
              <span className={`badge ${searchParams.competitor === c.id ? 'ok' : ''}`}>
                {c.name} ({c.adCount})
              </span>
            </Link>
          ))}
      </div>

      {groups.length === 0 ? (
        <div className="empty">
          수집된 광고가 없습니다. <Link href="/competitors">경쟁사</Link>를 등록하고 "지금 수집"을 실행하세요.
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.id} style={{ marginBottom: 32 }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{g.name}</span>
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>광고 {g.ads.length}</span>
              <Link href={qs({ competitor: g.id })} className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
                이 경쟁사만 보기 →
              </Link>
            </h2>
            <div className="grid">
              {g.ads.map((ad) => (
                <AdCardView key={ad.id} ad={ad} />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
