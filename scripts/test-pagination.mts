/**
 * 일회성 테스트 — 투명성 센터 목록 페이지네이션(=스크롤)이 광고 전체를 커버하는지 실측.
 * 목록 RPC(SearchCreatives)만 호출하고 상세는 건드리지 않는다(요청 수 최소화).
 * 실행: pnpm tsx scripts/test-pagination.mts <advertiserId> [region]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const BASE = 'https://adstransparency.google.com/anji/_/rpc';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const advertiserId = process.argv[2] ?? 'AR16035993894130810881';
const region = Number(process.argv[3] ?? 2410);
const NUM = 40; // 페이지당 (투명성 센터 기본)
const THROTTLE = Number(process.env.CRAWL_THROTTLE_MS ?? 3000);
const MAX_PAGES = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => THROTTLE + Math.floor(Math.random() * THROTTLE);

async function listPage(pageToken?: string) {
  const req: Record<string, unknown> = {
    2: NUM,
    3: { 12: { 1: '', 2: true }, 13: { 1: [advertiserId] } },
    7: { 1: 1, 2: 0, 3: region },
  };
  if (pageToken) req['4'] = pageToken;
  const { stdout } = await execFileAsync(
    'curl',
    [
      '-s', '--max-time', '25', `${BASE}/SearchService/SearchCreatives?authuser=0`,
      '-H', 'content-type: application/x-www-form-urlencoded;charset=UTF-8',
      '-H', `user-agent: ${UA}`,
      '-H', 'origin: https://adstransparency.google.com',
      '-H', 'referer: https://adstransparency.google.com/',
      '--data-urlencode', `f.req=${JSON.stringify(req)}`,
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const t = stdout.trimStart();
  if (!t.startsWith('{')) throw new Error(`BLOCKED (응답 앞부분: ${t.slice(0, 60)})`);
  const json = JSON.parse(t);
  const rows: any[] = json['1'] ?? [];
  const items = rows
    .map((r) => ({ creativeId: typeof r['2'] === 'string' ? r['2'] : '', format: Number(r['4']) }))
    .filter((i) => i.creativeId);
  const next = typeof json['2'] === 'string' ? json['2'] : undefined;
  return { items, next };
}

const FORMAT: Record<number, string> = { 1: 'text', 2: 'image', 3: 'video' };
const seen = new Set<string>();
const byFormat: Record<string, number> = {};
let token: string | undefined;
let pages = 0;
let dupes = 0;
const t0 = Date.now();

console.log(`광고주 ${advertiserId} / region ${region} / 페이지당 ${NUM} / throttle ${THROTTLE}ms(지터)`);
console.log('페이지네이션 시작…\n');

try {
  for (; pages < MAX_PAGES; ) {
    const { items, next } = await listPage(token);
    pages += 1;
    let fresh = 0;
    for (const it of items) {
      if (seen.has(it.creativeId)) { dupes += 1; continue; }
      seen.add(it.creativeId);
      fresh += 1;
      const f = FORMAT[it.format] ?? `unknown(${it.format})`;
      byFormat[f] = (byFormat[f] ?? 0) + 1;
    }
    console.log(`  p${pages}: 응답 ${items.length}건, 신규 ${fresh}, 누적 ${seen.size}${next ? '' : '  ← nextPageToken 없음(끝)'}`);
    if (!next) break;
    token = next;
    await sleep(jitter());
  }
} catch (e) {
  console.log(`\n⚠️ 중단: ${e instanceof Error ? e.message : String(e)}`);
}

const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\n=== 결과 ===`);
console.log(`페이지 ${pages} / 고유 광고 ${seen.size} / 중복 ${dupes} / 소요 ${secs}초`);
console.log(`형식별:`, byFormat);
console.log(`페이지 상한(${MAX_PAGES}) 도달:`, pages >= MAX_PAGES ? '예 ⚠️' : '아니오');
