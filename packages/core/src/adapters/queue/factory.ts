import type { Env } from '../../config/env.js';
import { AzureStorageQueueClient } from './azureStorageQueue.js';
import type { QueueClient } from './types.js';

export function createQueueClient(env: Env): QueueClient {
  return new AzureStorageQueueClient(env.AzureWebJobsStorage);
}
