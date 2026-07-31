import { QueueServiceClient, type QueueClient as AzQueueClient } from '@azure/storage-queue';
import type { QueueClient, QueueMessage } from './types.js';

/**
 * Azure Storage Queue 구현. Azurite("UseDevelopmentStorage=true")와 실제 Azure 계정을
 * 동일 코드로 처리한다. 메시지 본문은 JSON→base64 로 인코딩한다(큐 기본 규약과 호환).
 */
export class AzureStorageQueueClient implements QueueClient {
  private readonly service: QueueServiceClient;
  private readonly clients = new Map<string, AzQueueClient>();

  constructor(connectionString: string) {
    this.service = QueueServiceClient.fromConnectionString(connectionString);
  }

  private async client(queue: string): Promise<AzQueueClient> {
    let c = this.clients.get(queue);
    if (!c) {
      c = this.service.getQueueClient(queue);
      await c.createIfNotExists();
      this.clients.set(queue, c);
    }
    return c;
  }

  private static encode(body: unknown): string {
    return Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
  }

  private static decode<T>(raw: string): T {
    // base64 로 인코딩된 경우 우선 디코딩, 실패 시 평문 JSON 으로 폴백
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as T;
    } catch {
      return JSON.parse(raw) as T;
    }
  }

  async enqueue<T>(queue: string, body: T, opts?: { visibilityTimeoutMs?: number }): Promise<void> {
    const c = await this.client(queue);
    await c.sendMessage(AzureStorageQueueClient.encode(body), {
      // 지연 재적재 — 이 시간 동안 숨겼다가 소비 가능 (크롤 페이싱의 휴식 구현)
      visibilityTimeout: opts?.visibilityTimeoutMs ? Math.ceil(opts.visibilityTimeoutMs / 1000) : undefined,
    });
  }

  async receive<T>(queue: string, max = 1): Promise<QueueMessage<T>[]> {
    const c = await this.client(queue);
    const res = await c.receiveMessages({ numberOfMessages: max });
    return res.receivedMessageItems.map((m) => ({
      id: m.messageId,
      popReceipt: m.popReceipt,
      dequeueCount: m.dequeueCount,
      body: AzureStorageQueueClient.decode<T>(m.messageText),
    }));
  }

  async delete(queue: string, m: { id: string; popReceipt: string }): Promise<void> {
    const c = await this.client(queue);
    await c.deleteMessage(m.id, m.popReceipt);
  }
}
