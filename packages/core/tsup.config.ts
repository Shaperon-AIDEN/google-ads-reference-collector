import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  // 무거운 Azure SDK / pg 는 번들하지 않고 의존성으로 둔다 (콜드스타트·중복 회피).
  external: ['pg', '@azure/storage-queue', '@azure/storage-blob', 'drizzle-orm'],
});
