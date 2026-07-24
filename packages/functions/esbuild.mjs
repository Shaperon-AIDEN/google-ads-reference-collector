import { build } from 'esbuild';

/**
 * Functions 앱을 단일 dist/index.js 로 번들한다.
 * pnpm 심링크 node_modules 가 Azure zip-deploy 에서 깨지는 문제를 회피한다.
 * 네이티브/무거운 의존성은 external 로 두고 배포 패키지에 node_modules 로 포함한다.
 */
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  sourcemap: true,
  // Azure Functions 런타임은 워커가 제공하므로 제외. pg 는 순수 JS 라 번들에 포함하고
  // (pnpm 심링크 node_modules 해석 회피), 옵셔널 네이티브 모듈만 external 로 둔다.
  external: ['@azure/functions', 'pg-native'],
  banner: {
    // ESM 번들에서 require/__dirname 를 쓰는 하위 의존성 호환
    js: "import { createRequire as _cr } from 'module'; const require = _cr(import.meta.url);",
  },
  logLevel: 'info',
});
