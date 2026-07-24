import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AdvertiserSearch, AdvertiserSuggestion } from './types.js';

const execFileAsync = promisify(execFile);

const RPC_URL =
  'https://adstransparency.google.com/anji/_/rpc/SearchService/SearchSuggestions?authuser=0';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

type Json = Record<string, unknown>;

/** f.req 본문을 받아 응답 원문(JSON 문자열)을 돌려주는 전송 계층 (테스트에서 주입 가능) */
export type SuggestTransport = (reqBody: string) => Promise<string>;

/**
 * curl 서브프로세스로 요청한다. Google 은 Node(undici/https)의 TLS 시그니처를 봇으로
 * 탐지·차단하지만 curl 은 통과한다. execFile(배열 인자)로 셸을 거치지 않아 인젝션 안전.
 * curl 은 dev(macOS)·Azure App Service(Linux)에 기본 포함된다.
 */
async function curlTransport(reqBody: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'curl',
    [
      '-s',
      '--max-time',
      '10',
      RPC_URL,
      '-H',
      'content-type: application/x-www-form-urlencoded;charset=UTF-8',
      '-H',
      `user-agent: ${UA}`,
      '-H',
      'origin: https://adstransparency.google.com',
      '-H',
      'referer: https://adstransparency.google.com/',
      '--data-urlencode',
      `f.req=${reqBody}`,
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout;
}

function toInt(v: unknown): number | undefined {
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  if (typeof v === 'number') return v;
  return undefined;
}

/**
 * Google 광고 투명성 센터의 광고주 자동완성(SearchSuggestions) 어댑터.
 * 회사명 → 광고주 후보(id·이름·지역·광고 수). SerpApi 쿼터를 쓰지 않는다.
 *
 * ⚠️ 비공식 내부 RPC. 요청: f.req={"1":<query>,"2":<limit>}.
 * 응답: { "1": [ { "1": { "1":이름, "2":advertiserId, "3":지역, "4":{"2":{"1":low,"2":high}} } } ] }
 */
export class GoogleTransparencyAdvertiserSearch implements AdvertiserSearch {
  readonly name = 'google-transparency';
  private readonly transport: SuggestTransport;

  constructor(transport: SuggestTransport = curlTransport) {
    this.transport = transport;
  }

  async searchByName(query: string, opts: { limit?: number } = {}): Promise<AdvertiserSuggestion[]> {
    const q = query.trim();
    if (!q) return [];
    const limit = opts.limit ?? 10;

    const raw = await this.transport(JSON.stringify({ 1: q, 2: limit }));

    let json: Json;
    try {
      json = JSON.parse(raw) as Json;
    } catch {
      // 차단 시 HTML 에러 페이지가 오므로 JSON 파싱 실패 → 안내용 예외
      throw new Error('광고주 검색 응답을 파싱할 수 없습니다 (일시적으로 차단되었을 수 있음)');
    }
    if (typeof json['2'] === 'string' && (json['2'] as string).includes('Exception')) {
      throw new Error('광고주 검색 요청 형식 오류');
    }

    const list = (json['1'] as Json[] | undefined) ?? [];
    const out: AdvertiserSuggestion[] = [];
    for (const entry of list) {
      const a = entry['1'] as Json | undefined;
      if (!a) continue;
      const advertiserId = typeof a['2'] === 'string' ? a['2'] : '';
      if (!advertiserId) continue;
      const count = ((a['4'] as Json | undefined)?.['2'] as Json | undefined) ?? {};
      out.push({
        advertiserId,
        advertiser: typeof a['1'] === 'string' ? a['1'] : advertiserId,
        region: typeof a['3'] === 'string' ? a['3'] : undefined,
        adCountLow: toInt(count['1']),
        adCountHigh: toInt(count['2']),
      });
    }
    return out;
  }
}
