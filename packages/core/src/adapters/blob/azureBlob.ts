import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import type { BlobStore } from './types.js';

/**
 * Azure Blob Storage 구현. Azurite 와 실제 Azure 계정을 동일 코드로 처리한다.
 */
export class AzureBlobStore implements BlobStore {
  private readonly service: BlobServiceClient;
  private readonly containers = new Map<string, ContainerClient>();

  constructor(connectionString: string) {
    this.service = BlobServiceClient.fromConnectionString(connectionString);
  }

  private async container(name: string): Promise<ContainerClient> {
    let c = this.containers.get(name);
    if (!c) {
      c = this.service.getContainerClient(name);
      await c.createIfNotExists();
      this.containers.set(name, c);
    }
    return c;
  }

  async put(
    container: string,
    path: string,
    data: Buffer,
    contentType: string,
  ): Promise<{ path: string; url: string }> {
    const c = await this.container(container);
    const block = c.getBlockBlobClient(path);
    await block.uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } });
    return { path, url: block.url };
  }

  getUrl(container: string, path: string): string {
    return this.service.getContainerClient(container).getBlockBlobClient(path).url;
  }
}
