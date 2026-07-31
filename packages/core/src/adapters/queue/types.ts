export interface QueueMessage<T> {
  id: string;
  popReceipt: string;
  dequeueCount: number;
  body: T;
}

/**
 * 큐 어댑터. 운영에서 dequeue 는 Functions Queue Trigger 가 처리하지만,
 * 스크립트·E2E 테스트를 위해 receive/delete 도 제공한다.
 * 로컬(Azurite)↔Azure 전환은 연결 문자열만 다르다.
 */
export interface QueueClient {
  /** opts.visibilityTimeoutMs: 이 시간 동안 메시지를 숨겼다가 소비 가능하게 함 (지연 재적재용) */
  enqueue<T>(queue: string, body: T, opts?: { visibilityTimeoutMs?: number }): Promise<void>;
  receive<T>(queue: string, max?: number): Promise<QueueMessage<T>[]>;
  delete(queue: string, m: { id: string; popReceipt: string }): Promise<void>;
}
