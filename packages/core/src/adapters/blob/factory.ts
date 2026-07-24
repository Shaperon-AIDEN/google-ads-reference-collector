import type { Env } from '../../config/env.js';
import { AzureBlobStore } from './azureBlob.js';
import type { BlobStore } from './types.js';

export function createBlobStore(env: Env): BlobStore {
  return new AzureBlobStore(env.AzureWebJobsStorage);
}
