/**
 * 쿼터 가드 — 월 API 예산의 임계치(기본 80%)에 도달하면 추가 호출을 차단한다.
 * 수집기는 각 외부 API 호출 전에 canCall() 을 확인하고, 소진 시 status='partial' 로 중단한다.
 */
export class QuotaGuard {
  private used: number;
  readonly monthlyBudget: number;
  readonly throttlePct: number;

  constructor(params: { monthlyBudget: number; throttlePct?: number; usedThisMonth?: number }) {
    this.monthlyBudget = params.monthlyBudget;
    this.throttlePct = params.throttlePct ?? 0.8;
    this.used = params.usedThisMonth ?? 0;
  }

  /** 임계치 이하이면 호출 허용 */
  canCall(): boolean {
    return this.used < this.threshold();
  }

  /** 소비한 API 호출 수를 누적 */
  record(calls: number): void {
    this.used += Math.max(0, calls);
  }

  /** 차단이 시작되는 호출 수 (예산 × 임계비율) */
  threshold(): number {
    return Math.floor(this.monthlyBudget * this.throttlePct);
  }

  usedCalls(): number {
    return this.used;
  }

  /** 임계치에 도달했는가 (경보·주기 완화 트리거) */
  isThrottled(): boolean {
    return !this.canCall();
  }
}
