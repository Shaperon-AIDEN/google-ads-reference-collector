import type { Db } from '../client.js';
import { adMetrics, type NewAdMetric } from '../schema.js';

export class AdMetricRepository {
  constructor(private readonly db: Db) {}

  /**
   * 일별 스냅샷 적재. (ad_id, snapshot_date) 중복 시 무시 — 조회수 이력은 갱신이 아니라
   * 하루 1건씩 누적해 성장 추세를 보존한다.
   */
  async insertSnapshot(input: NewAdMetric): Promise<void> {
    await this.db.insert(adMetrics).values(input).onConflictDoNothing({
      target: [adMetrics.adId, adMetrics.snapshotDate],
    });
  }
}
