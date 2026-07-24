/**
 * Blob 저장소 어댑터 (썸네일·영상 캐시). 로컬(Azurite)↔Azure 전환은 연결 문자열만 다르다.
 */
export interface BlobStore {
  put(
    container: string,
    path: string,
    data: Buffer,
    contentType: string,
  ): Promise<{ path: string; url: string }>;
  getUrl(container: string, path: string): string;
}
