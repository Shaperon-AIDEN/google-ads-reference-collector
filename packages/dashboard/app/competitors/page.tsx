import { listCompetitors } from '@/lib/queries';
import CompetitorOnboarding from './CompetitorOnboarding';
import CompetitorList from './CompetitorList';

export const dynamic = 'force-dynamic';

export default async function CompetitorsPage() {
  const competitors = await listCompetitors();
  return (
    <>
      <h1>경쟁사 관리 <span className="muted">({competitors.length})</span></h1>
      <CompetitorOnboarding />
      <h2>등록된 경쟁사</h2>
      <CompetitorList competitors={competitors} />
    </>
  );
}
