import { describe, expect, it } from 'vitest';
import { QuotaGuard } from '../src/domain/quotaGuard.js';

describe('QuotaGuard', () => {
  it('임계치(예산×80%) 미만이면 호출 허용', () => {
    const g = new QuotaGuard({ monthlyBudget: 5000, throttlePct: 0.8 });
    expect(g.threshold()).toBe(4000);
    expect(g.canCall()).toBe(true);
  });

  it('임계치 도달 시 차단', () => {
    const g = new QuotaGuard({ monthlyBudget: 5000, throttlePct: 0.8, usedThisMonth: 3999 });
    expect(g.canCall()).toBe(true);
    g.record(1); // 4000 도달
    expect(g.canCall()).toBe(false);
    expect(g.isThrottled()).toBe(true);
  });

  it('record 는 사용량을 누적', () => {
    const g = new QuotaGuard({ monthlyBudget: 100, throttlePct: 0.8 });
    g.record(50);
    g.record(30);
    expect(g.usedCalls()).toBe(80);
    expect(g.canCall()).toBe(false); // 임계치 80
  });

  it('기본 throttlePct 는 0.8', () => {
    const g = new QuotaGuard({ monthlyBudget: 1000 });
    expect(g.threshold()).toBe(800);
  });
});
