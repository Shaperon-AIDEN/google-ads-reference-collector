import { loadEnv, type Env } from '@adref/core';

let cached: Env | undefined;

/** 서버 전용 환경 로더 (Next.js 서버 컴포넌트·route handler 에서 사용) */
export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}
